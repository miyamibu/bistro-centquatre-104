import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { supabaseServer } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { apiError } from "@/lib/api-security";
import { isBearerSecretAuthorized } from "@/lib/bearer-auth";
import { getRequestId, logError, logInfo, logWarn } from "@/lib/logger";
import {
  markSchedulerFailed,
  markSchedulerStarted,
  markSchedulerSucceeded,
  readSchedulerContext,
} from "@/lib/scheduler-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const ORDER_HISTORY_RETENTION_DAYS = 365;
const LINE_WEBHOOK_INBOX_RETENTION_DAYS = 30;
const LINE_WEBHOOK_INBOX_DELETE_BATCH_SIZE = 200;
const LINE_LINK_TOKEN_RETENTION_DAYS = 7;
const LINE_LINK_TOKEN_DELETE_BATCH_SIZE = 500;
const RATE_LIMIT_EVENT_RETENTION_HOURS = 48;
const IDEMPOTENCY_RETENTION_DAYS = 200;
const EPHEMERAL_SECURITY_DELETE_BATCH_SIZE = 500;
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
  return isBearerSecretAuthorized(req.headers.get("authorization"), env.CRON_SECRET);
}

async function executeDeleteOldHistories(req: NextRequest) {
  const requestId = getRequestId(req);
  const route = "/api/crons/delete-old-histories";

  if (!isAuthorizedCron(req)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const scheduler = readSchedulerContext(req);
  try {
    await markSchedulerStarted("DATA_RETENTION", scheduler);
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
        await markSchedulerFailed("DATA_RETENTION", scheduler, "CRON_SELECT_FAILED");
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
        await markSchedulerFailed("DATA_RETENTION", scheduler, "CRON_DELETE_FAILED");
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
      await markSchedulerFailed("DATA_RETENTION", scheduler, "CRON_ORDER_PII_SELECT_FAILED");
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
      await markSchedulerFailed("DATA_RETENTION", scheduler, "CRON_ORDER_PII_SELECT_FAILED");
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
        await markSchedulerFailed(
          "DATA_RETENTION",
          scheduler,
          "CRON_ORDER_PII_ANONYMIZE_FAILED"
        );
        return apiError(500, {
          error: "Database error",
          code: "CRON_ORDER_PII_ANONYMIZE_FAILED",
          requestId,
        });
      }

      anonymizedOrderCount = terminalOrderIds.length;
    }

    // The runtime role has no direct DELETE privilege. A bounded SECURITY
    // DEFINER function is the only deletion path for expired link tokens.
    let deletedExpiredTokens = 0;
    try {
      const tokenExpiryThreshold = new Date(
        Date.now() - LINE_LINK_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000
      );
      const rows = await prisma.$queryRaw<Array<{ deleted_count: bigint | number }>>(
        Prisma.sql`SELECT public.cleanup_expired_reservation_line_link_tokens(
          ${tokenExpiryThreshold},
          ${LINE_LINK_TOKEN_DELETE_BATCH_SIZE}
        ) AS deleted_count`
      );
      deletedExpiredTokens = Number(rows[0]?.deleted_count ?? 0);
      if (deletedExpiredTokens > 0) {
        logInfo("crons.delete_old_histories.expired_tokens_deleted", {
          requestId,
          route,
          context: { deletedExpiredTokens },
        });
      }
    } catch (tokenCleanupError) {
      // Non-fatal during phased rollout where the cleanup migration may not exist yet.
      logWarn("crons.delete_old_histories.token_cleanup_skipped", {
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

    let deletedRateLimitEventCount = 0;
    let deletedIdempotencyCount = 0;
    try {
      const rateLimitThreshold = new Date(
        Date.now() - RATE_LIMIT_EVENT_RETENTION_HOURS * 60 * 60 * 1000
      );
      const idempotencyThreshold = new Date(
        Date.now() - IDEMPOTENCY_RETENTION_DAYS * 24 * 60 * 60 * 1000
      );
      const rows = await prisma.$queryRaw<
        Array<{
          deleted_rate_limit_count: bigint | number;
          deleted_idempotency_count: bigint | number;
        }>
      >(Prisma.sql`SELECT * FROM public.cleanup_ephemeral_reservation_security_state(
        ${rateLimitThreshold},
        ${idempotencyThreshold},
        ${EPHEMERAL_SECURITY_DELETE_BATCH_SIZE}
      )`);
      deletedRateLimitEventCount = Number(rows[0]?.deleted_rate_limit_count ?? 0);
      deletedIdempotencyCount = Number(rows[0]?.deleted_idempotency_count ?? 0);
    } catch (ephemeralCleanupError) {
      logWarn("crons.delete_old_histories.ephemeral_security_cleanup_skipped", {
        requestId,
        route,
        context: {
          message:
            ephemeralCleanupError instanceof Error
              ? ephemeralCleanupError.message
              : String(ephemeralCleanupError),
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
        deletedRateLimitEventCount,
        deletedIdempotencyCount,
      },
    });
    await markSchedulerSucceeded("DATA_RETENTION", scheduler, {
      processed:
        deletedCount +
        anonymizedOrderCount +
        deletedExpiredTokens +
        deletedLineWebhookInboxCount +
        deletedRateLimitEventCount +
        deletedIdempotencyCount,
      retry: 0,
      deadLetter: 0,
      backlog: hasMore ? 1 : 0,
      oldestBacklogAt: null,
    });

    return NextResponse.json({
      ok: true,
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
      deletedRateLimitEventCount,
      rateLimitEventRetentionHours: RATE_LIMIT_EVENT_RETENTION_HOURS,
      deletedIdempotencyCount,
      idempotencyRetentionDays: IDEMPOTENCY_RETENTION_DAYS,
      requestId,
    });
  } catch (error) {
    await markSchedulerFailed("DATA_RETENTION", scheduler, "INTERNAL_SERVER_ERROR").catch(
      () => undefined
    );
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

// The free GitHub scheduler calls this route via HTTP GET. Authorization is
// enforced inside executeDeleteOldHistories via CRON_SECRET Bearer check.
export async function GET(req: NextRequest) {
  return executeDeleteOldHistories(req);
}
