import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getRequestId, logError } from "@/lib/logger";
import { processOrderNotificationOutbox } from "@/lib/order-notification-outbox";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  return !!env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED", requestId }, { status: 401 });
  }

  try {
    const summary = await processOrderNotificationOutbox({ requestId });
    return NextResponse.json({ ok: true, requestId, ...summary });
  } catch (error) {
    logError("order_notification_outbox.cron_failed", {
      requestId,
      route: "/api/crons/process-order-notifications",
      errorCode: "ORDER_NOTIFICATION_OUTBOX_CRON_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json(
      { ok: false, code: "ORDER_NOTIFICATION_OUTBOX_CRON_FAILED", requestId },
      { status: 500 }
    );
  }
}
