import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { supabaseServer } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { apiError } from "@/lib/api-security";
import { getRequestId, logError, logInfo, logWarn } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const ORDER_HISTORY_RETENTION_DAYS = 365;
const LINE_WEBHOOK_INBOX_RETENTION_DAYS = 30;
const LINE_WEBHOOK_INBOX_DELETE_BATCH_SIZE = 200;
const DELETE_BATCH_SIZE = 200;
const MAX_DELETE_PER_RUN = 1000;
const ORDER_PII_ANONYMIZE_BATCH_SIZE = 200;
const REDACTED_ORDER_PII = {
  customer_name: "[retention-redacted]",
  email: "retention-redacted@example.invalid",
  phone: "0000000000",
  zip_code: "0000000",
  prefecture: "[retention-redacted]",
  city: "[retention-redacted]",
  address: "[retention-redacted]",
  building: null,
};

function isAuthorizedCron(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  return !!env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
}

async function executeDeleteOldHistories(req: NextRequest) {
  const requestId = getRequestId(req);
  const route = "/api/crons/delete-old-histories";

  if (!isAuthorizedCron(req)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  try {
    const retentionThreshold = new Date();
    retentionThreshold.setDate(retentionThreshold.getDate() - ORDER_HISTORY_RETENTION_DAYS);
    const retentionThresholdString = retentionThreshold.toISOString();

    let deletedCount = 0;

    while (deletedCount < MAX_DELETE_PER_RUN) {
      const remaining = MAX_DELETE_PER_RUN - deletedCount;
      const batchLimit = Math.min(DELETE_BATCH_SIZE, remaining);

      const { data: oldHistories, error: selectError } = await supabaseServer
        .from("order_history")
        .select("id")
        .lt("deleted_at", retentionThresholdString)
        .order("deleted_at", { ascending: true })
        .limit(batchLimit);

      if (selectError) {
        logError("crons.delete_old_histories.select_failed", {
          requestId,
          route,
          errorCode: "CRON_SELECT_FAILED",
          context: { message: selectError.message, deletedCount },
        });
        return apiError(500, {
          error: "Database error",
          code: "CRON_SELECT_FAILED",
          requestId,
        });
      }

      if (!oldHistories || oldHistories.length === 0) {
        break;
      }

      const oldIds = oldHistories.map((history) => history.id);
      const { error: deleteError } = await supabaseServer
        .from("order_history")
        .delete()
        .in("id", oldIds);

      if (deleteError) {
        logError("crons.delete_old_histories.delete_failed", {
          requestId,
          route,
          errorCode: "CRON_DELETE_FAILED",
          context: { message: deleteError.message, deletedCount, batchSize: oldIds.length },
        });
        return apiError(500, {
          error: "Delete error",
          code: "CRON_DELETE_FAILED",
          requestId,
          deletedCount,
        });
      }

      deletedCount += oldIds.length;
    }

    const hasMore = deletedCount >= MAX_DELETE_PER_RUN;
    const { data: oldShippedOrders, error: shippedSelectError } = await supabaseServer
      .from("orders")
      .select("id")
      .eq("status", "SHIPPED")
      .lt("shipped_at", retentionThresholdString)
      .neq("email", REDACTED_ORDER_PII.email)
      .limit(ORDER_PII_ANONYMIZE_BATCH_SIZE);

    if (shippedSelectError) {
      logError("crons.delete_old_histories.order_pii_select_failed", {
        requestId,
        route,
        errorCode: "CRON_ORDER_PII_SELECT_FAILED",
        context: { message: shippedSelectError.message, status: "SHIPPED" },
      });
      return apiError(500, {
        error: "Database error",
        code: "CRON_ORDER_PII_SELECT_FAILED",
        requestId,
      });
    }

    const remainingAnonymizeLimit = Math.max(
      0,
      ORDER_PII_ANONYMIZE_BATCH_SIZE - (oldShippedOrders?.length ?? 0)
    );
    const { data: oldCancelledOrders, error: cancelledSelectError } =
      remainingAnonymizeLimit > 0
        ? await supabaseServer
            .from("orders")
            .select("id")
            .eq("status", "CANCELLED")
            .lt("canceled_at", retentionThresholdString)
            .neq("email", REDACTED_ORDER_PII.email)
            .limit(remainingAnonymizeLimit)
        : { data: [], error: null };

    if (cancelledSelectError) {
      logError("crons.delete_old_histories.order_pii_select_failed", {
        requestId,
        route,
        errorCode: "CRON_ORDER_PII_SELECT_FAILED",
        context: { message: cancelledSelectError.message, status: "CANCELLED" },
      });
      return apiError(500, {
        error: "Database error",
        code: "CRON_ORDER_PII_SELECT_FAILED",
        requestId,
      });
    }

    const terminalOrderIds = [...(oldShippedOrders ?? []), ...(oldCancelledOrders ?? [])].map(
      (order) => order.id
    );
    let anonymizedOrderCount = 0;
    if (terminalOrderIds.length > 0) {
      const { error: anonymizeError } = await supabaseServer
        .from("orders")
        .update(REDACTED_ORDER_PII)
        .in("id", terminalOrderIds);

      if (anonymizeError) {
        logError("crons.delete_old_histories.order_pii_anonymize_failed", {
          requestId,
          route,
          errorCode: "CRON_ORDER_PII_ANONYMIZE_FAILED",
          context: { message: anonymizeError.message, batchSize: terminalOrderIds.length },
        });
        return apiError(500, {
          error: "Database error",
          code: "CRON_ORDER_PII_ANONYMIZE_FAILED",
          requestId,
        });
      }

      anonymizedOrderCount = terminalOrderIds.length;
    }

    // Clean up expired ReservationLineLinkTokens (expired > 7 days ago).
    let deletedExpiredTokens = 0;
    try {
      const tokenExpiryThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const { count } = await prisma.reservationLineLinkToken.deleteMany({
        where: { expiresAt: { lt: tokenExpiryThreshold } },
      });
      deletedExpiredTokens = count;
      if (count > 0) {
        logInfo("crons.delete_old_histories.expired_tokens_deleted", {
          requestId,
          route,
          context: { deletedExpiredTokens },
        });
      }
    } catch (tokenCleanupError) {
      // Non-fatal: log and continue — table may not exist if migration not yet applied.
      logInfo("crons.delete_old_histories.token_cleanup_skipped", {
        requestId,
        route,
        context: {
          message: tokenCleanupError instanceof Error ? tokenCleanupError.message : String(tokenCleanupError),
        },
      });
    }

    // Only completed, minimized webhook receipts are eligible. Pending, failed,
    // and processing rows remain available for retry and incident recovery.
    let deletedLineWebhookInboxCount = 0;
    try {
      const lineInboxThreshold = new Date(
        Date.now() - LINE_WEBHOOK_INBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000
      );
      const rows = await prisma.$queryRaw<Array<{ deleted_count: bigint | number }>>(
        Prisma.sql`SELECT public.cleanup_processed_line_webhook_inbox(
          ${lineInboxThreshold},
          ${LINE_WEBHOOK_INBOX_DELETE_BATCH_SIZE}
        ) AS deleted_count`
      );
      deletedLineWebhookInboxCount = Number(rows[0]?.deleted_count ?? 0);
    } catch (lineInboxCleanupError) {
      // Non-fatal during phased rollout where the inbox migration may not exist yet.
      logWarn("crons.delete_old_histories.line_webhook_cleanup_skipped", {
        requestId,
        route,
        context: {
          message:
            lineInboxCleanupError instanceof Error
              ? lineInboxCleanupError.message
              : String(lineInboxCleanupError),
        },
      });
    }

    logInfo("crons.delete_old_histories.success", {
      requestId,
      route,
      context: {
        deletedCount,
        hasMore,
        anonymizedOrderCount,
        deletedExpiredTokens,
        deletedLineWebhookInboxCount,
      },
    });

    return NextResponse.json({
      message: deletedCount === 0 ? "No old order histories to delete" : "Processed old order history deletion batch",
      deletedCount,
      hasMore,
      maxDeletePerRun: MAX_DELETE_PER_RUN,
      batchSize: DELETE_BATCH_SIZE,
      retentionDays: ORDER_HISTORY_RETENTION_DAYS,
      anonymizedOrderCount,
      anonymizeBatchSize: ORDER_PII_ANONYMIZE_BATCH_SIZE,
      deletedExpiredTokens,
      deletedLineWebhookInboxCount,
      lineWebhookInboxRetentionDays: LINE_WEBHOOK_INBOX_RETENTION_DAYS,
      requestId,
    });
  } catch (error) {
    logError("crons.delete_old_histories.unexpected", {
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
  return executeDeleteOldHistories(req);
}

// Vercel Cron calls routes via HTTP GET. Authorization is enforced inside
// executeDeleteOldHistories via CRON_SECRET Bearer check.
export async function GET(req: NextRequest) {
  return executeDeleteOldHistories(req);
}
