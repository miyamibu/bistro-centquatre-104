import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-security";
import { env } from "@/lib/env";
import { getRequestId, logError } from "@/lib/logger";
import { processReservationEmailOutbox } from "@/lib/reservation-email-outbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorizedCron(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return !!env.CRON_SECRET && authorization === `Bearer ${env.CRON_SECRET}`;
}

async function execute(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!isAuthorizedCron(request)) {
    return apiError(401, {
      error: "Unauthorized",
      code: "UNAUTHORIZED",
      requestId,
    });
  }

  try {
    const summary = await processReservationEmailOutbox({ requestId });
    if (summary.failed > 0 || summary.deadLetter > 0 || summary.unsafe > 0) {
      return apiError(500, {
        ...summary,
        error: "Cron partially failed",
        code: "CRON_RESERVATION_EMAIL_OUTBOX_PARTIAL_FAILURE",
        requestId,
      });
    }

    return NextResponse.json({ ok: true, ...summary, requestId });
  } catch (error) {
    logError("crons.reservation_email_outbox.failed", {
      requestId,
      route: "/api/crons/process-reservation-emails",
      errorCode: "CRON_RESERVATION_EMAIL_OUTBOX_FAILED",
      context: {
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
    });
    return apiError(500, {
      error: "Cron execution failed",
      code: "CRON_RESERVATION_EMAIL_OUTBOX_FAILED",
      requestId,
    });
  }
}

export async function GET(request: NextRequest) {
  return execute(request);
}

export async function POST(request: NextRequest) {
  return execute(request);
}
