import { NextRequest, NextResponse } from "next/server";
import { ReservationStatus, ReservationType } from "@prisma/client";
import { addDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { formatJst, todayJst } from "@/lib/dates";
import { env, hasLineMessagingEnv } from "@/lib/env";
import { apiError } from "@/lib/api-security";
import { getRequestId, logError, logInfo } from "@/lib/logger";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  findReservationsCompat,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

async function executeReminderCron() {
  await ensureReservationSchemaReady(prisma);

  const tomorrow = addDays(todayJst(), 1);
  const target = formatJst(tomorrow);

  const reservations = await findReservationsCompat(prisma, {
    where: {
      date: target,
      status: ReservationStatus.CONFIRMED,
      reservationType: ReservationType.NORMAL,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!hasLineMessagingEnv()) {
    logInfo("crons.remind.skipped.line_not_configured", {
      route: "/api/crons/remind",
      context: { date: target, count: reservations.length },
    });
    return NextResponse.json({
      status: "SKIPPED_LINE_SETUP",
      date: target,
      count: reservations.length,
    });
  }

  // 将来のLINE送信処理をここに実装
  logInfo("crons.remind.ready", {
    route: "/api/crons/remind",
    context: { date: target, count: reservations.length },
  });
  return NextResponse.json({ status: "OK", date: target, count: reservations.length });
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
