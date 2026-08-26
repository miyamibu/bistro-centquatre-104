import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-security";
import { env } from "@/lib/env";
import { getRequestId, logError } from "@/lib/logger";
import {
  getOrderNotificationOutboxBacklog,
  processOrderNotificationOutbox,
} from "@/lib/order-notification-outbox";
import {
  markSchedulerFailed,
  markSchedulerStarted,
  markSchedulerSucceeded,
  readSchedulerContext,
} from "@/lib/scheduler-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorizedCron(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  return !!env.CRON_SECRET && authorization === `Bearer ${env.CRON_SECRET}`;
}

function parsePositiveInteger(value: string | null, fallback: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function execute(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!isAuthorizedCron(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const scheduler = readSchedulerContext(request);
  try {
    await markSchedulerStarted("ORDER_NOTIFICATION", scheduler);
    const params = request.nextUrl.searchParams;
    const limit = parsePositiveInteger(params.get("limit"), 10);
    const deadlineMs = parsePositiveInteger(params.get("deadlineMs"), 8_000);
    const summary = await processOrderNotificationOutbox({ requestId, limit, deadlineMs });
    const backlog = await getOrderNotificationOutboxBacklog();
    if (summary.failed > 0 || summary.deadLetter > 0) {
      await markSchedulerFailed(
        "ORDER_NOTIFICATION",
        scheduler,
        "CRON_ORDER_NOTIFICATION_OUTBOX_PARTIAL_FAILURE",
      );
      return apiError(500, {
        ...summary,
        error: "Cron partially failed",
        code: "CRON_ORDER_NOTIFICATION_OUTBOX_PARTIAL_FAILURE",
        requestId,
      });
    }
    await markSchedulerSucceeded("ORDER_NOTIFICATION", scheduler, {
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
      "ORDER_NOTIFICATION",
      scheduler,
      "CRON_ORDER_NOTIFICATION_OUTBOX_FAILED",
    ).catch(() => undefined);
    logError("crons.order_notification_outbox.failed", {
      requestId,
      route: "/api/crons/process-order-notifications",
      errorCode: "CRON_ORDER_NOTIFICATION_OUTBOX_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Cron execution failed",
      code: "CRON_ORDER_NOTIFICATION_OUTBOX_FAILED",
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
