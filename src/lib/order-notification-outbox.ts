import { sendOrderConfirmationEmail } from "@/lib/email";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { supabaseServer } from "@/lib/supabase-server";

type OrderNotificationOutboxRow = {
  id: string;
  order_id: string;
  attempts: number | null;
  error_code: string | null;
};

const PROCESSING_STALE_AFTER_MS = 10 * 60 * 1000;
const MARK_SENT_FAILED_ERROR_CODE = "ORDER_NOTIFICATION_OUTBOX_MARK_SENT_FAILED";

function eligibleOutboxFilter(staleBefore: string) {
  return `status.in.(PENDING,FAILED),and(status.eq.PROCESSING,last_attempt_at.lt.${staleBefore},error_code.is.null)`;
}

type OrderEmailItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

type OrderEmailRow = {
  id: string;
  customer_name: string;
  email: string;
  phone: string;
  zip_code: string;
  prefecture: string;
  city: string;
  address: string;
  building: string | null;
  items: unknown;
  total: number | null;
  payment_method: string | null;
  store_visit_date: string | null;
};

type BankAccountRow = {
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  account_holder: string;
};

function normalizeEmailItems(items: unknown): OrderEmailItem[] {
  if (!Array.isArray(items)) return [];

  return items
    .filter(
      (item): item is OrderEmailItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { name?: unknown }).name === "string" &&
        typeof (item as { price?: unknown }).price === "number" &&
        typeof (item as { quantity?: unknown }).quantity === "number"
    )
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      name: item.name,
      price: item.price,
      quantity: item.quantity,
    }));
}

async function markOutboxFailed(input: {
  outboxId: string;
  requestId: string;
  errorCode: string;
}) {
  const { error } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      status: "FAILED",
      error_code: input.errorCode,
    })
    .eq("id", input.outboxId);

  if (error) {
    logError("orders.notification_outbox.mark_failed_failed", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: "ORDER_NOTIFICATION_OUTBOX_MARK_FAILED_FAILED",
      context: { outboxId: input.outboxId, message: error.message },
    });
  }
}

export async function processOrderConfirmationOutboxForOrder(input: {
  orderId: string;
  requestId: string;
}) {
  const staleBefore = new Date(Date.now() - PROCESSING_STALE_AFTER_MS).toISOString();
  const { data: pendingRows, error: pendingError } = await supabaseServer
    .from("order_notification_outbox")
    .select("id, order_id, attempts, error_code")
    .eq("order_id", input.orderId)
    .eq("type", "ORDER_CONFIRMATION")
    .or(eligibleOutboxFilter(staleBefore))
    .order("created_at", { ascending: true })
    .limit(1);

  if (pendingError) {
    logError("orders.notification_outbox.lookup_failed", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: "ORDER_NOTIFICATION_OUTBOX_LOOKUP_FAILED",
      context: { orderId: input.orderId, message: pendingError.message },
    });
    return { processed: false, sent: false, reason: "LOOKUP_FAILED" as const };
  }

  const row = (pendingRows?.[0] ?? null) as OrderNotificationOutboxRow | null;
  if (!row) {
    return { processed: false, sent: false, reason: "NO_PENDING_OUTBOX" as const };
  }

  const attempts = Number(row.attempts ?? 0) + 1;
  const { data: claimedRows, error: claimError } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      status: "PROCESSING",
      attempts,
      last_attempt_at: new Date().toISOString(),
      error_code: null,
    })
    .eq("id", row.id)
    .or(eligibleOutboxFilter(staleBefore))
    .select("id");

  if (claimError || !claimedRows?.length) {
    logWarn("orders.notification_outbox.claim_skipped", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: "ORDER_NOTIFICATION_OUTBOX_CLAIM_SKIPPED",
      context: { outboxId: row.id, message: claimError?.message ?? "Already claimed" },
    });
    return { processed: false, sent: false, reason: "CLAIM_SKIPPED" as const };
  }

  const { data: orderRow, error: orderError } = await supabaseServer
    .from("orders")
    .select(
      "id, customer_name, email, phone, zip_code, prefecture, city, address, building, items, total, payment_method, store_visit_date"
    )
    .eq("id", input.orderId)
    .maybeSingle();

  if (orderError || !orderRow) {
    await markOutboxFailed({
      outboxId: row.id,
      requestId: input.requestId,
      errorCode: "ORDER_EMAIL_CONTEXT_FETCH_FAILED",
    });
    return { processed: true, sent: false, reason: "ORDER_EMAIL_CONTEXT_FETCH_FAILED" as const };
  }

  const order = orderRow as OrderEmailRow;
  let bankAccount: BankAccountRow | undefined;
  if (order.payment_method === "BANK_TRANSFER") {
    const { data: bankRows, error: bankError } = await supabaseServer
      .from("bank_account")
      .select("*")
      .limit(1);

    if (bankError) {
      await markOutboxFailed({
        outboxId: row.id,
        requestId: input.requestId,
        errorCode: "BANK_ACCOUNT_FETCH_FAILED",
      });
      return { processed: true, sent: false, reason: "BANK_ACCOUNT_FETCH_FAILED" as const };
    }

    bankAccount = (bankRows?.[0] as BankAccountRow | undefined) ?? undefined;
  }

  const emailResult = await sendOrderConfirmationEmail(
    {
      name: String(order.customer_name),
      email: String(order.email),
      phone: String(order.phone),
      zipCode: String(order.zip_code),
      prefecture: String(order.prefecture),
      city: String(order.city),
      address: String(order.address),
      building: typeof order.building === "string" ? order.building : "",
    },
    normalizeEmailItems(order.items),
    Number(order.total ?? 0),
    order.payment_method === "PAY_IN_STORE" ? "PAY_IN_STORE" : "BANK_TRANSFER",
    typeof order.store_visit_date === "string" ? order.store_visit_date : undefined,
    bankAccount
  ).catch(async (error: unknown) => {
    logError("orders.notification_outbox.email_thrown", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: "ORDER_CONFIRMATION_EMAIL_THROWN",
      context: {
        outboxId: row.id,
        orderId: input.orderId,
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      sent: false as const,
      reason: "ORDER_CONFIRMATION_EMAIL_THROWN" as const,
      target: "customer" as const,
    };
  });

  if (!emailResult.sent) {
    await markOutboxFailed({
      outboxId: row.id,
      requestId: input.requestId,
      errorCode: emailResult.reason,
    });
    logWarn("orders.notification_outbox.email_failed", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: emailResult.reason,
      context: { outboxId: row.id, orderId: input.orderId, target: emailResult.target },
    });
    return { processed: true, sent: false, reason: emailResult.reason };
  }

  const { error: sentError } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      status: "SENT",
      sent_at: new Date().toISOString(),
      error_code: null,
    })
    .eq("id", row.id);

  if (sentError) {
    const { error: reconcileError } = await supabaseServer
      .from("order_notification_outbox")
      .update({
        status: "SENT",
        sent_at: new Date().toISOString(),
        error_code: MARK_SENT_FAILED_ERROR_CODE,
      })
      .eq("id", row.id);

    logError("orders.notification_outbox.mark_sent_failed", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: MARK_SENT_FAILED_ERROR_CODE,
      context: {
        outboxId: row.id,
        message: sentError.message,
        reconciled: !reconcileError,
        reconcileMessage: reconcileError?.message,
      },
    });
    return {
      processed: true,
      sent: true,
      reason: "MARK_SENT_FAILED" as const,
      durableState: !reconcileError,
    };
  }

  logInfo("orders.notification_outbox.email_sent", {
    requestId: input.requestId,
    route: "/api/orders/[id]/actions",
    context: {
      outboxId: row.id,
      orderId: input.orderId,
      provider: emailResult.provider,
      adminSent: emailResult.adminSent,
    },
  });

  return { processed: true, sent: true, reason: "SENT" as const, durableState: true };
}
