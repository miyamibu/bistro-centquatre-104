import { NextRequest, NextResponse } from "next/server";
import { ReservationStatus, ReservationType } from "@prisma/client";
import { addDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import {
  formatJst,
  getJstDayOfMonth,
  startOfJstMonth,
  todayJst,
} from "@/lib/dates";
import { env, hasLineMessagingEnv } from "@/lib/env";
import { apiError } from "@/lib/api-security";
import { getRequestId, logError, logInfo, logWarn } from "@/lib/logger";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  findReservationsCompat,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";
import {
  buildReminderRetryKey,
  getLineMonthlyQuotaConsumption,
  summarizeLineError,
} from "@/lib/line";
import { claimAndSendLineReminder } from "@/lib/line-notification";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Configurable via env; defaults match LINE free tier limits.
const FREE_TIER_HARD_LIMIT = env.LINE_MONTHLY_REMINDER_LIMIT ?? 200;
const FREE_TIER_WARN_THRESHOLD = env.LINE_MONTHLY_REMINDER_WARN_THRESHOLD ?? 180;
const STATUS_SKIPPED_QUOTA = "SKIPPED_QUOTA";

function isCronAuthorized(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  return !!env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
}

async function countMonthlyRemindersSent(): Promise<number> {
  const monthStart = startOfJstMonth(todayJst());
  return prisma.reservation.count({
    where: { lineReminderSentAt: { gte: monthStart } },
  });
}

async function executeReminderCron() {
  await ensureReservationSchemaReady(prisma);

  const today = todayJst();
  const tomorrow = addDays(today, 1);
  const target = formatJst(tomorrow);

  const candidates = await findReservationsCompat(prisma, {
    where: {
      date: target,
      status: ReservationStatus.CONFIRMED,
      reservationType: ReservationType.NORMAL,
      lineUserId: { not: null },
      lineReminderSentAt: null,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!hasLineMessagingEnv()) {
    logInfo("crons.remind.skipped.line_not_configured", {
      route: "/api/crons/remind",
      context: { date: target, count: candidates.length },
    });
    return NextResponse.json({
      status: "SKIPPED_LINE_SETUP",
      date: target,
      count: candidates.length,
    });
  }

  // Day-1 of the JST month: log approximate quota consumption (observability only).
  if (getJstDayOfMonth(today) === 1) {
    const usage = await getLineMonthlyQuotaConsumption();
    logInfo("crons.remind.quota_snapshot", {
      route: "/api/crons/remind",
      context: { usage },
    });
  }

  const monthlySentBefore = await countMonthlyRemindersSent();
  if (monthlySentBefore >= FREE_TIER_WARN_THRESHOLD) {
    logWarn("crons.remind.quota_warning", {
      route: "/api/crons/remind",
      context: { monthlySentBefore },
    });
  }

  let monthlySent = monthlySentBefore;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let skippedQuota = 0;

  // Sequential dispatch only — Promise.all is forbidden for this loop.
  for (const reservation of candidates) {
    if (!reservation.lineUserId) continue;

    if (monthlySent >= FREE_TIER_HARD_LIMIT) {
      // Mark quota-skipped on both Reservation and NotificationEvent.
      try {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: {
            lineReminderStatus: STATUS_SKIPPED_QUOTA,
            lineReminderError: "LINE monthly free quota guard reached",
          },
        });
        await prisma.notificationEvent.upsert({
          where: {
            reservationId_channel_type_targetDate: {
              reservationId: reservation.id,
              channel: "LINE",
              type: "DAY_BEFORE_REMINDER",
              targetDate: target,
            },
          },
          create: {
            reservationId: reservation.id,
            channel: "LINE",
            type: "DAY_BEFORE_REMINDER",
            targetDate: target,
            status: "SKIPPED",
            retryKey: buildReminderRetryKey(reservation.id, target),
            error: "quota",
            updatedAt: new Date(),
          },
          update: { status: "SKIPPED", error: "quota", updatedAt: new Date() },
        });
      } catch (updateError) {
        logError("crons.remind.skip_update_failed", {
          route: "/api/crons/remind",
          errorCode: "CRON_REMIND_UPDATE_FAILED",
          context: {
            reservationId: reservation.id,
            message: summarizeLineError(updateError),
          },
        });
      }
      skippedQuota += 1;
      continue;
    }

    const outcome = await claimAndSendLineReminder(
      reservation.id,
      reservation.lineUserId,
      target,
      "CRON"
    );

    if (outcome === "sent") {
      monthlySent += 1;
      sent += 1;
    } else if (outcome === "failed") {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  logInfo("crons.remind.completed", {
    route: "/api/crons/remind",
    context: {
      date: target,
      totalCandidates: candidates.length,
      sent,
      failed,
      skipped,
      skippedQuota,
      monthlySentBefore,
    },
  });

  return NextResponse.json({
    ok: true,
    targetDate: target,
    totalCandidates: candidates.length,
    sent,
    failed,
    skipped,
    skippedQuota,
    monthlySentBefore,
  });
}

async function executeRemind(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!isCronAuthorized(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  try {
    return await executeReminderCron();
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    logError("crons.remind.failed", {
      requestId,
      route: "/api/crons/remind",
      errorCode: "CRON_REMIND_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Cron execution failed",
      code: "CRON_REMIND_FAILED",
      requestId,
    });
  }
}

export async function POST(request: NextRequest) {
  return executeRemind(request);
}

// Vercel Cron calls routes via HTTP GET. Authorization is enforced inside
// executeRemind via CRON_SECRET Bearer check — the x-vercel-cron header
// guard has been removed so production GET requests are not rejected 405.
export async function GET(request: NextRequest) {
  return executeRemind(request);
}
