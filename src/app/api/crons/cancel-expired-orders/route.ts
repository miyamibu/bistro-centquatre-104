import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { env } from "@/lib/env";
import { apiError } from "@/lib/api-security";
import { archiveOrderHistoryByOrderId } from "@/lib/order-history";
import { executeCancelOrderAction, OrderActionError } from "@/lib/order-actions";
import { getRequestId, logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const STATUS_FETCH_LIMIT = 50;
const MAX_ORDERS_PER_RUN = 200;

function isAuthorizedCron(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  return !!env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
}

function isGetCompatibilityRequest(req: NextRequest) {
  return req.headers.get("x-vercel-cron") === "1" || req.nextUrl.searchParams.get("compat") === "1";
}

async function executeCancelExpired(req: NextRequest) {
  const requestId = getRequestId(req);
  const route = "/api/crons/cancel-expired-orders";

  if (!isAuthorizedCron(req)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  try {
    const nowIso = new Date().toISOString();
    let cancelledCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let scannedCount = 0;

    while (scannedCount < MAX_ORDERS_PER_RUN) {
      const remaining = MAX_ORDERS_PER_RUN - scannedCount;
      const perStatusLimit = Math.max(1, Math.min(STATUS_FETCH_LIMIT, Math.ceil(remaining / 2)));

      const [quotedResponse, pendingResponse] = await Promise.all([
        supabaseServer
          .from("orders")
          .select("id, version, status, hold_expires_at, expires_at, canceled_at")
          .is("canceled_at", null)
          .eq("status", "QUOTED")
          .lt("hold_expires_at", nowIso)
          .order("hold_expires_at", { ascending: true })
          .limit(perStatusLimit),
        supabaseServer
          .from("orders")
          .select("id, version, status, hold_expires_at, expires_at, canceled_at")
          .is("canceled_at", null)
          .eq("status", "PENDING_PAYMENT")
          .lt("expires_at", nowIso)
          .order("expires_at", { ascending: true })
          .limit(perStatusLimit),
      ]);

      const quotedError = quotedResponse.error;
      const pendingError = pendingResponse.error;
      const selectError = quotedError ?? pendingError;

      if (selectError) {
        logError("crons.cancel_expired.select_failed", {
          requestId,
          route,
          errorCode: "CRON_SELECT_FAILED",
          context: {
            message: selectError.message,
            quotedError: quotedError?.message ?? null,
            pendingError: pendingError?.message ?? null,
            scannedCount,
          },
        });
        return apiError(500, {
          error: "Database error",
          code: "CRON_SELECT_FAILED",
          requestId,
        });
      }

      let ordersToCancel = [...(quotedResponse.data ?? []), ...(pendingResponse.data ?? [])];
      if (ordersToCancel.length === 0) {
        break;
      }

      if (ordersToCancel.length > remaining) {
        ordersToCancel = ordersToCancel.slice(0, remaining);
      }

      scannedCount += ordersToCancel.length;

      for (const order of ordersToCancel) {
        const isExpiredHold =
          order.status === "QUOTED" &&
          !!order.hold_expires_at &&
          new Date(String(order.hold_expires_at)).getTime() < Date.now();

        const reasonCode = isExpiredHold ? "EXPIRED_HOLD" : "EXPIRED_PAYMENT";

        try {
          await executeCancelOrderAction({
            orderId: String(order.id),
            expectedVersion: Number(order.version ?? 0),
            reasonCode,
            actorType: "cron",
            actorId: "cron",
            requestId,
            idempotencyKey: `cron:${requestId}:${order.id}:${reasonCode}`,
            adminNote: "cancel-expired-orders cron",
          });

          await archiveOrderHistoryByOrderId({
            orderId: String(order.id),
            source: "cron",
            requestId,
          });

          cancelledCount += 1;
        } catch (error) {
          if (
            error instanceof OrderActionError &&
            (error.code === "VERSION_CONFLICT" ||
              error.code === "ALREADY_CANCELLED" ||
              error.code === "ALREADY_COMPLETED")
          ) {
            skippedCount += 1;
            continue;
          }

          failedCount += 1;
          logError("crons.cancel_expired.cancel_failed", {
            requestId,
            route,
            errorCode: "CRON_CANCEL_FAILED",
            context: {
              orderId: String(order.id),
              reasonCode,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
    }

    const hasMore = scannedCount >= MAX_ORDERS_PER_RUN;

    if (failedCount > 0) {
      return apiError(500, {
        error: "Cron partially failed",
        code: "CRON_PARTIAL_FAILURE",
        requestId,
        scannedCount,
        cancelledCount,
        skippedCount,
        failedCount,
        hasMore,
      });
    }

    logInfo("crons.cancel_expired.success", {
      requestId,
      route,
      context: { cancelledCount, skippedCount, scannedCount, hasMore },
    });

    return NextResponse.json({
      message:
        scannedCount === 0
          ? "No orders to cancel"
          : "Processed expired quoted/pending-payment orders",
      scannedCount,
      cancelledCount,
      skippedCount,
      failedCount,
      hasMore,
      maxOrdersPerRun: MAX_ORDERS_PER_RUN,
      requestId,
    });
  } catch (error) {
    logError("crons.cancel_expired.unexpected", {
      requestId,
      route,
      errorCode: "INTERNAL_SERVER_ERROR",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
      requestId,
    });
  }
}

export async function POST(req: NextRequest) {
  return executeCancelExpired(req);
}

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req);
  if (!isGetCompatibilityRequest(req)) {
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

  return executeCancelExpired(req);
}
