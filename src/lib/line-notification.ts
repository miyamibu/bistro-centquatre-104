/**
 * Shared LINE reminder dispatch with NotificationEvent as a durable claim/ledger.
 * Both the cron and post-link immediate send use this function so that the cron
 * can never double-send a reminder already dispatched at link time (and vice versa).
 *
 * Concurrency contract
 * --------------------
 * - "sent"    LINE API accepted + NotificationEvent = SENT + Reservation.lineReminderSentAt set.
 * - "skipped" Event already SENT, or another worker holds a fresh SENDING claim.
 * - "failed"  LINE push failed OR a critical DB update failed after send.
 *
 * After-send DB failure strategy
 * --------------------------------
 * If NotificationEvent cannot be updated to SENT, we return "failed" so the next
 * cron run will reclaim (stale SENDING) and retry with the same deterministic
 * retryKey — LINE deduplicates with HTTP 409, treats it as success, and the
 * ledger converges to SENT.
 *
 * If Reservation.lineReminderSentAt cannot be written AFTER the NotificationEvent
 * is already SENT, we return "sent" — the cron skips (event.status === SENT), so
 * no double-send occurs. A CRITICAL log flags the gap for manual reconciliation.
 */
import { randomUUID } from "node:crypto";
import { Prisma, ReservationStatus, ReservationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildReminderRetryKey,
  buildReminderText,
  pushLineTextMessage,
  summarizeLineError,
} from "@/lib/line";
import { startOfJstMonth } from "@/lib/dates";
import { logError, logInfo, logWarn } from "@/lib/logger";

const STATUS_SENT = "SENT";
const STATUS_FAILED = "FAILED";
const STATUS_SENDING = "SENDING";
const STATUS_PENDING = "PENDING";
const STATUS_SKIPPED_BLOCKED = "SKIPPED_BLOCKED";
const STATUS_SKIPPED_QUOTA = "SKIPPED_QUOTA";
const DEFAULT_MONTHLY_QUOTA = 200;

/** A SENDING claim older than this is considered stale and may be reclaimed. */
export const STALE_SENDING_MS = 30 * 60 * 1000;

export type LineReminderOutcome = "sent" | "skipped" | "failed" | "quota";

function resolveMonthlyQuota(limit: number | undefined): number {
  if (Number.isSafeInteger(limit) && limit !== undefined && limit > 0) return limit;

  const configured = Number(process.env.LINE_MONTHLY_REMINDER_LIMIT);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_MONTHLY_QUOTA;
}

async function claimNotificationEvent(input: {
  eventId: string;
  reservationId: string;
  currentStatus: string;
  currentClaimedAt: Date | null;
  monthlyQuota: number;
}): Promise<{ claimToken: string } | { skipped: true } | { quota: true }> {
  const claimToken = randomUUID();
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - STALE_SENDING_MS);
  const monthStart = startOfJstMonth(now);
  const staleReclaim =
    input.currentStatus === STATUS_SENDING &&
    (input.currentClaimedAt === null ||
      input.currentClaimedAt.getTime() < staleThreshold.getTime());

  return prisma.$transaction(async (tx) => {
    // Serialize the quota check and claim across cron invocations. The lock is
    // transaction-scoped and does not hold a reservation row lock over the provider call.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('bistro:line-reminder-quota'))`
    );

    const used = await tx.notificationEvent.count({
      where: {
        channel: "LINE",
        type: "DAY_BEFORE_REMINDER",
        OR: [
          { status: STATUS_SENT, sentAt: { gte: monthStart } },
          { status: STATUS_SENDING, claimedAt: { gte: staleThreshold } },
        ],
      },
    });

    const eligible = {
      id: input.eventId,
      OR: [
        { status: STATUS_PENDING },
        { status: STATUS_FAILED },
        { status: STATUS_SENDING, claimedAt: { lt: staleThreshold } },
        { status: STATUS_SENDING, claimedAt: null },
      ],
    };

    if (used >= input.monthlyQuota && !staleReclaim) {
      const skipped = await tx.notificationEvent.updateMany({
        where: eligible,
        data: {
          status: "SKIPPED",
          error: STATUS_SKIPPED_QUOTA,
          claimedAt: null,
          claimToken: null,
          updatedAt: now,
        },
      });

      if (skipped.count === 1) {
        await tx.reservation.updateMany({
          where: { id: input.reservationId },
          data: {
            lineReminderStatus: STATUS_SKIPPED_QUOTA,
            lineReminderError: "LINE monthly quota guard reached",
          },
        });
        return { quota: true } as const;
      }

      return { skipped: true } as const;
    }

    const claimed = await tx.notificationEvent.updateMany({
      where: eligible,
      data: {
        status: STATUS_SENDING,
        claimedAt: now,
        claimToken,
        error: null,
        updatedAt: now,
      },
    });

    return claimed.count === 1
      ? { claimToken }
      : ({ skipped: true } as const);
  });
}

/**
 * Returns true if an immediate day-before reminder should be sent right now.
 * Requires JST time >= 12:00 to match the cron's 12:00 JST window.
 */
export function shouldSendImmediateDayBeforeReminder(now: Date): boolean {
  // Convert to JST (UTC+9) and check hours.
  const jstHour = (now.getUTCHours() + 9) % 24;
  return jstHour >= 12;
}

export async function claimAndSendLineReminder(
  reservationId: string,
  lineUserId: string,
  targetDate: string,
  source: string,
  options: { monthlyQuota?: number } = {}
): Promise<LineReminderOutcome> {
  const retryKey = buildReminderRetryKey(reservationId, targetDate);

  // Upsert event — preserve existing status (never downgrade SENT / active SENDING).
  const event = await prisma.notificationEvent.upsert({
    where: {
      reservationId_channel_type_targetDate: {
        reservationId,
        channel: "LINE",
        type: "DAY_BEFORE_REMINDER",
        targetDate,
      },
    },
    create: {
      reservationId,
      channel: "LINE",
      type: "DAY_BEFORE_REMINDER",
      targetDate,
      status: STATUS_PENDING,
      retryKey,
      updatedAt: new Date(),
    },
    update: {},
  });

  if (event.status === STATUS_SENT) return "skipped";

  // Skip a recently-claimed SENDING event to avoid double-send.
  if (
    event.status === STATUS_SENDING &&
    event.claimedAt &&
    Date.now() - event.claimedAt.getTime() < STALE_SENDING_MS
  ) {
    return "skipped";
  }

  let claim: { claimToken: string } | { skipped: true } | { quota: true };
  try {
    claim = await claimNotificationEvent({
      eventId: event.id,
      reservationId,
      currentStatus: event.status,
      currentClaimedAt: event.claimedAt,
      monthlyQuota: resolveMonthlyQuota(options.monthlyQuota),
    });
  } catch (error) {
    logError("line_notification.claim_failed", {
      errorCode: "NOTIF_EVENT_CLAIM_FAILED",
      context: { reservationId, source, error: summarizeLineError(error) },
    });
    return "failed";
  }

  if ("quota" in claim) return "quota";
  if ("skipped" in claim) return "skipped";
  const claimToken = claim.claimToken;

  // Re-fetch reservation immediately before sending to guard against cancellations
  // or status changes that occurred between the cron query and now.
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      date: true,
      arrivalTime: true,
      partySize: true,
      status: true,
      reservationType: true,
      lineUserId: true,
      lineReminderSentAt: true,
    },
  });

  async function updateClaimedEvent(data: Record<string, unknown>, errorCode: string) {
    const updated = await prisma.notificationEvent.updateMany({
      where: {
        id: event.id,
        status: STATUS_SENDING,
        claimToken,
      },
      data: {
        ...data,
        claimToken: null,
        claimedAt: null,
        updatedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      logWarn("line_notification.claim_fence_lost", {
        errorCode,
        context: { reservationId, source },
      });
      return false;
    }

    return true;
  }

  async function markSkipped(reason: string, skippedStatus?: string) {
    const skipStatus = skippedStatus ?? "SKIPPED";
    await updateClaimedEvent(
      { status: skipStatus, error: reason },
      "NOTIF_EVENT_SKIP_FENCE_LOST"
    ).catch(() => false);
  }

  if (!reservation) {
    await markSkipped("reservation not found");
    // Missing reservation is not retryable — treat as skipped to avoid noise.
    return "skipped";
  }

  // Guard: must still be CONFIRMED NORMAL reservation for the target date.
  if (reservation.status !== ReservationStatus.CONFIRMED) {
    await markSkipped(`skipped: status=${reservation.status}`);
    logWarn("line.reminder.skipped.not_confirmed", {
      context: { reservationId, source, status: reservation.status },
    });
    return "skipped";
  }
  if (reservation.reservationType !== ReservationType.NORMAL) {
    await markSkipped(`skipped: reservationType=${reservation.reservationType}`);
    return "skipped";
  }
  if (reservation.lineUserId !== lineUserId) {
    await markSkipped("skipped: lineUserId mismatch");
    logWarn("line.reminder.skipped.lineuserid_mismatch", { context: { reservationId, source } });
    return "skipped";
  }
  if (reservation.lineReminderSentAt !== null) {
    await markSkipped("skipped: already sent");
    return "skipped";
  }
  if (reservation.date !== targetDate) {
    await markSkipped(`skipped: date mismatch (got ${reservation.date})`);
    return "skipped";
  }

  // Guard: check LineFriend block status.
  const friend = await prisma.lineFriend
    .findUnique({ where: { lineUserId }, select: { friendshipStatus: true } })
    .catch(() => null);
  if (friend?.friendshipStatus === "BLOCKED") {
    await markSkipped("BLOCKED user", STATUS_SKIPPED_BLOCKED);
    logWarn("line.reminder.skipped.blocked", { context: { reservationId, source } });
    return "skipped";
  }

  const text = buildReminderText({
    date: reservation.date,
    arrivalTime: reservation.arrivalTime,
    partySize: reservation.partySize,
  });

  const result = await pushLineTextMessage({ to: lineUserId, text, retryKey });
  const afterSend = new Date();

  if (!result.ok) {
    const errMsg = summarizeLineError(result.error ?? "unknown");
    let eventUpdated = false;
    try {
      eventUpdated = await updateClaimedEvent(
        { status: STATUS_FAILED, error: errMsg },
        "NOTIF_EVENT_FAILED_FENCE_LOST"
      );
    } catch (e) {
      logError("line_notification.event_failed_update_error", {
        errorCode: "NOTIF_EVENT_UPDATE_FAILED",
        context: { reservationId, source, error: summarizeLineError(e) },
      });
    }

    if (!eventUpdated) return "failed";

    await prisma.reservation
      .update({
        where: { id: reservationId },
        data: { lineReminderStatus: STATUS_FAILED, lineReminderError: errMsg },
      })
      .catch((e) =>
        logError("line_notification.reservation_failed_update_error", {
          errorCode: "RESERVATION_UPDATE_FAILED",
          context: { reservationId, source, error: summarizeLineError(e) },
        })
      );
    return "failed";
  }

  // LINE API accepted the request. Update NotificationEvent first — this is the idempotency guard.
  // If this fails, return "failed" so the next cron retries with the same retryKey
  // (LINE returns 409 = already accepted) and eventually marks SENT.
  try {
    const eventUpdated = await updateClaimedEvent(
      { status: STATUS_SENT, sentAt: afterSend, error: null },
      "NOTIF_EVENT_SENT_FENCE_LOST"
    );
    if (!eventUpdated) throw new Error("NOTIF_EVENT_CLAIM_FENCE_LOST_AFTER_SEND");
  } catch (notifErr) {
    logError("line_notification.event_sent_update_failed", {
      errorCode: "NOTIF_EVENT_UPDATE_FAILED_AFTER_SEND",
      context: { reservationId, source, error: summarizeLineError(notifErr) },
    });
    return "failed";
  }

  // NotificationEvent is now SENT, so the cron will skip this reservation even if
  // the Reservation update below fails.  Any failure here is a data-consistency gap,
  // not a double-send risk.
  try {
    await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        lineReminderSentAt: afterSend,
        lineReminderStatus: STATUS_SENT,
        lineReminderError: null,
      },
    });
  } catch (reservErr) {
    logError("line_notification.reservation_sent_update_failed", {
      errorCode: "RESERVATION_UPDATE_FAILED_AFTER_SEND",
      context: { reservationId, source, error: summarizeLineError(reservErr) },
    });
    return "sent";
  }

  logInfo("line.reminder.sent", { context: { reservationId, source } });
  return "sent";
}
