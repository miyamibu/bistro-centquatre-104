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
  buildReminderText,
  getLineMonthlyQuotaConsumption,
  pushLineTextMessage,
  summarizeLineError,
} from "@/lib/line";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FREE_TIER_HARD_LIMIT = 200;
const FREE_TIER_WARN_THRESHOLD = 180;
const REMINDER_STATUS_SENT = "SENT";
const REMINDER_STATUS_FAILED = "FAILED";
const REMINDER_STATUS_SKIPPED_QUOTA = "SKIPPED_QUOTA";

function isCronAuthorized(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  return !!env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
}

function isGetCompatibilityRequest(request: NextRequest) {
  return (
    request.headers.get("x-vercel-cron") === "1" ||
    request.nextUrl.searchParams.get("compat") === "1"
  );
}

async function countMonthlyRemindersSent(): Promise<number> {
  const monthStart = startOfJstMonth(todayJst());
  return prisma.reservation.count({
    where: {
      lineReminderSentAt: { gte: monthStart },
    },
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
  let skippedQuota = 0;

  // Sequential dispatch only — Promise.all is forbidden for this loop.
  for (const reservation of candidates) {
    if (!reservation.lineUserId) {
      continue;
    }
    if (monthlySent >= FREE_TIER_HARD_LIMIT) {
      try {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: {
            lineReminderStatus: REMINDER_STATUS_SKIPPED_QUOTA,
            lineReminderError: "LINE monthly free quota guard reached",
          },
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

    const retryKey = buildReminderRetryKey(reservation.id, target);
    const text = buildReminderText({
      date: reservation.date,
      arrivalTime: reservation.arrivalTime,
      partySize: reservation.partySize,
    });

    const result = await pushLineTextMessage({
      to: reservation.lineUserId,
      text,
      retryKey,
    });

    if (result.ok) {
      try {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: {
            lineReminderSentAt: new Date(),
            lineReminderStatus: REMINDER_STATUS_SENT,
            lineReminderError: null,
          },
        });
        monthlySent += 1;
        sent += 1;
      } catch (updateError) {
        // DB update failed but LINE delivered — count as failure for visibility.
        failed += 1;
        logError("crons.remind.sent_update_failed", {
          route: "/api/crons/remind",
          errorCode: "CRON_REMIND_UPDATE_FAILED",
          context: {
            reservationId: reservation.id,
            message: summarizeLineError(updateError),
          },
        });
      }
    } else {
      failed += 1;
      try {
        await prisma.reservation.update({
          where: { id: reservation.id },
          data: {
            lineReminderStatus: REMINDER_STATUS_FAILED,
            lineReminderError: summarizeLineError(result.error ?? "unknown"),
          },
        });
      } catch (updateError) {
        logError("crons.remind.failed_update_failed", {
          route: "/api/crons/remind",
          errorCode: "CRON_REMIND_UPDATE_FAILED",
          context: {
            reservationId: reservation.id,
            message: summarizeLineError(updateError),
          },
        });
      }
    }
  }

  logInfo("crons.remind.completed", {
    route: "/api/crons/remind",
    context: {
      date: target,
      totalCandidates: candidates.length,
      sent,
      failed,
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
    const response = await executeReminderCron();
    return response;
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

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!isGetCompatibilityRequest(request)) {
    return apiError(
      405,
      {
        error: "Method not allowed. Use POST.",
        code: "METHOD_NOT_ALLOWED",
        requestId,
      },
      { headers: { Allow: "POST" } }
    );
  }
  return executeRemind(request);
}
