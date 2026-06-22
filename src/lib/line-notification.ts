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
import { ReservationStatus, ReservationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildReminderRetryKey,
  buildReminderText,
  pushLineTextMessage,
  summarizeLineError,
} from "@/lib/line";
import { logError, logInfo, logWarn } from "@/lib/logger";

const STATUS_SENT = "SENT";
const STATUS_FAILED = "FAILED";
const STATUS_SENDING = "SENDING";
const STATUS_PENDING = "PENDING";
const STATUS_SKIPPED_BLOCKED = "SKIPPED_BLOCKED";

/** A SENDING claim older than this is considered stale and may be reclaimed. */
export const STALE_SENDING_MS = 30 * 60 * 1000;

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
  source: string
): Promise<"sent" | "skipped" | "failed"> {
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

  // Atomically claim via conditional updateMany.
  // Only succeeds if the current status is PENDING, FAILED, or stale SENDING.
  const staleThreshold = new Date(Date.now() - STALE_SENDING_MS);
  const now = new Date();
  const claimed = await prisma.notificationEvent.updateMany({
    where: {
      id: event.id,
      OR: [
        { status: STATUS_PENDING },
        { status: STATUS_FAILED },
        { status: STATUS_SENDING, claimedAt: { lt: staleThreshold } },
      ],
    },
    data: { status: STATUS_SENDING, claimedAt: now, updatedAt: now },
  });

  if (claimed.count === 0) return "skipped"; // Another worker claimed first.

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

  async function markSkipped(reason: string, skippedStatus?: string) {
    const skipStatus = skippedStatus ?? "SKIPPED";
    await prisma.notificationEvent
      .update({
        where: { id: event.id },
        data: { status: skipStatus, error: reason, updatedAt: new Date() },
      })
      .catch(() => { /* best-effort */ });
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
    await prisma.notificationEvent
      .update({
        where: { id: event.id },
        data: { status: STATUS_FAILED, error: errMsg, updatedAt: afterSend },
      })
      .catch((e) =>
        logError("line_notification.event_failed_update_error", {
          errorCode: "NOTIF_EVENT_UPDATE_FAILED",
          context: { reservationId, source, error: summarizeLineError(e) },
        })
      );
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
    await prisma.notificationEvent.update({
      where: { id: event.id },
      data: { status: STATUS_SENT, sentAt: afterSend, error: null, updatedAt: afterSend },
    });
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
