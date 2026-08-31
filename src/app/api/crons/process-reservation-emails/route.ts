import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-security";
import { isBearerSecretAuthorized } from "@/lib/bearer-auth";
import { env } from "@/lib/env";
import { getRequestId, logError } from "@/lib/logger";
import {
  getReservationEmailOutboxBacklog,
  processReservationEmailOutbox,
} from "@/lib/reservation-email-outbox";
import {
  markSchedulerFailed,
  markSchedulerStarted,
  markSchedulerSucceeded,
  readSchedulerContext,
} from "@/lib/scheduler-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorizedCron(request: NextRequest) {
  return isBearerSecretAuthorized(request.headers.get("authorization"), env.CRON_SECRET);
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
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

  const scheduler = readSchedulerContext(request);
  try {
    await markSchedulerStarted("RESERVATION_EMAIL", scheduler);
    const params = request.nextUrl.searchParams;
    const batchSize = parsePositiveInteger(params.get("batchSize"));
    const deadlineMs = parsePositiveInteger(params.get("deadlineMs"));
    const cursor = params.get("cursor")?.trim();
    const summary = await processReservationEmailOutbox({
      requestId,
      ...(batchSize ? { batchSize } : {}),
      ...(deadlineMs ? { deadlineMs } : {}),
      ...(cursor && cursor.length <= 512 ? { cursor } : {}),
    });
    const backlog = await getReservationEmailOutboxBacklog();
    if (summary.failed > 0 || summary.deadLetter > 0 || summary.unsafe > 0) {
      await markSchedulerFailed(
        "RESERVATION_EMAIL",
        scheduler,
        "CRON_RESERVATION_EMAIL_OUTBOX_PARTIAL_FAILURE",
      );
      return apiError(500, {
        ...summary,
        error: "Cron partially failed",
        code: "CRON_RESERVATION_EMAIL_OUTBOX_PARTIAL_FAILURE",
        requestId,
      });
    }

    await markSchedulerSucceeded("RESERVATION_EMAIL", scheduler, {
      processed: summary.scanned,
      retry: summary.failed,
      deadLetter: summary.deadLetter,
      backlog: backlog.backlog,
      oldestBacklogAt: backlog.oldestBacklogAt,
    });
    return NextResponse.json({
      ok: true,
      ...summary,
      backlog: backlog.backlog,
      oldestBacklogAt: backlog.oldestBacklogAt?.toISOString() ?? null,
      requestId,
    });
  } catch (error) {
    await markSchedulerFailed(
      "RESERVATION_EMAIL",
      scheduler,
      "CRON_RESERVATION_EMAIL_OUTBOX_FAILED",
    ).catch(() => undefined);
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
