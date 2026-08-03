import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-security";
import { hashOrderReceiptToken, ORDER_RECEIPT_TOKEN_MAX_LENGTH } from "@/lib/order-receipt";
import { getRequestId, logError } from "@/lib/logger";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_RECEIPT_TOKEN_HEADER = "x-order-receipt-token";
const RECEIPT_VISIBLE_STATUSES = new Set(["PENDING_PAYMENT", "PAID", "SHIPPED"]);

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}

function notFound(requestId: string) {
  return apiError(
    404,
    {
      error: "注文完了情報を確認できません",
      code: "ORDER_RECEIPT_NOT_FOUND",
      requestId,
    },
    { headers: noStoreHeaders() },
  );
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const requestId = getRequestId(request);
  const { id } = await params;
  // Keep the bearer token out of URLs, access logs, browser history, and referrers.
  const receiptToken = request.headers.get(ORDER_RECEIPT_TOKEN_HEADER)?.trim() ?? "";

  if (!ORDER_ID_PATTERN.test(id)) {
    return apiError(400, {
      error: "注文番号が不正です",
      code: "INVALID_ORDER_ID",
      requestId,
    });
  }

  if (
    !receiptToken ||
    receiptToken.length > ORDER_RECEIPT_TOKEN_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(receiptToken)
  ) {
    return notFound(requestId);
  }

  const tokenResult = await supabaseServer
    .from("order_receipt_tokens")
    .select("order_id, expires_at")
    .eq("order_id", id)
    .eq("token_hash", hashOrderReceiptToken(receiptToken))
    .maybeSingle();

  if (tokenResult.error) {
    logError("orders.receipt.token_lookup_failed", {
      requestId,
      route: "/api/orders/[id]/receipt",
      errorCode: "ORDER_RECEIPT_LOOKUP_FAILED",
      context: { orderId: id },
    });
    return apiError(
      503,
      {
        error: "注文完了情報を一時的に確認できません",
        code: "ORDER_RECEIPT_LOOKUP_UNAVAILABLE",
        requestId,
      },
      { headers: noStoreHeaders() },
    );
  }

  const tokenRow = tokenResult.data;
  if (
    !tokenRow ||
    typeof tokenRow.order_id !== "string" ||
    tokenRow.order_id !== id ||
    typeof tokenRow.expires_at !== "string" ||
    !Number.isFinite(Date.parse(tokenRow.expires_at)) ||
    Date.parse(tokenRow.expires_at) <= Date.now()
  ) {
    return notFound(requestId);
  }

  const orderResult = await supabaseServer
    .from("orders")
    .select("id, payment_method, store_visit_date, status")
    .eq("id", id)
    .maybeSingle();

  if (orderResult.error) {
    logError("orders.receipt.order_lookup_failed", {
      requestId,
      route: "/api/orders/[id]/receipt",
      errorCode: "ORDER_RECEIPT_ORDER_LOOKUP_FAILED",
      context: { orderId: id },
    });
    return apiError(
      503,
      {
        error: "注文完了情報を一時的に確認できません",
        code: "ORDER_RECEIPT_LOOKUP_UNAVAILABLE",
        requestId,
      },
      { headers: noStoreHeaders() },
    );
  }

  const order = orderResult.data as {
    id?: unknown;
    payment_method?: unknown;
    store_visit_date?: unknown;
    status?: unknown;
  } | null;
  if (
    !order ||
    order.id !== id ||
    typeof order.payment_method !== "string" ||
    !RECEIPT_VISIBLE_STATUSES.has(String(order.status)) ||
    (order.payment_method !== "BANK_TRANSFER" && order.payment_method !== "PAY_IN_STORE")
  ) {
    return notFound(requestId);
  }

  const notificationResult = await supabaseServer
    .from("order_notification_outbox")
    .select("status, customer_sent_at")
    .eq("order_id", id)
    .eq("notification_type", "ORDER_CONFIRMATION")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (notificationResult.error) {
    logError("orders.receipt.notification_lookup_failed", {
      requestId,
      route: "/api/orders/[id]/receipt",
      errorCode: "ORDER_RECEIPT_NOTIFICATION_LOOKUP_FAILED",
      context: { orderId: id },
    });
    return apiError(
      503,
      {
        error: "注文完了情報を一時的に確認できません",
        code: "ORDER_RECEIPT_LOOKUP_UNAVAILABLE",
        requestId,
      },
      { headers: noStoreHeaders() },
    );
  }

  const notification = notificationResult.data as {
    status?: unknown;
    customer_sent_at?: unknown;
  } | null;
  const notificationStatus =
    notification?.customer_sent_at || notification?.status === "SENT"
      ? "SENT"
      : "PENDING_RETRY";

  return NextResponse.json(
    {
      ok: true,
      orderId: id,
      paymentMethod: order.payment_method,
      storeVisitDate: typeof order.store_visit_date === "string" ? order.store_visit_date : null,
      notificationStatus,
    },
    { headers: noStoreHeaders() },
  );
}
