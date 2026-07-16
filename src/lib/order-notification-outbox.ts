import { sendOrderConfirmationEmail } from "@/lib/email";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { supabaseServer } from "@/lib/supabase-server";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

type OutboxStatus = "PENDING" | "PROCESSING" | "SENT" | "DEAD_LETTER";

type OutboxRow = {
  id: string;
  order_id: string;
  notification_type: string;
  attempts: number | null;
  max_attempts: number | null;
};

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
  payment_method: "BANK_TRANSFER" | "PAY_IN_STORE";
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

export async function enqueueOrderNotification(input: {
  orderId: string;
  notificationType: "ORDER_CONFIRMATION";
  requestId: string;
  idempotencyKey: string;
}) {
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .upsert(
      [
        {
          order_id: input.orderId,
          notification_type: input.notificationType,
          status: "PENDING" satisfies OutboxStatus,
          next_attempt_at: new Date().toISOString(),
          request_id: input.requestId,
          idempotency_key: input.idempotencyKey,
          max_attempts: MAX_ATTEMPTS,
        },
      ],
      { onConflict: "order_id,notification_type,idempotency_key" }
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      "ORDER_NOTIFICATION_OUTBOX_ENQUEUE_FAILED:" + (error?.message ?? "missing row")
    );
  }

  return String(data.id);
}

async function claimOutboxRow(id: string, requestId: string) {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      status: "PROCESSING" satisfies OutboxStatus,
      claimed_at: now.toISOString(),
      locked_until: lockedUntil,
      last_error: null,
      request_id: requestId,
    })
    .eq("id", id)
    .in("status", ["PENDING", "PROCESSING"])
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error("ORDER_NOTIFICATION_OUTBOX_CLAIM_FAILED:" + error.message);
  }
  return !!data;
}

async function markOutboxSent(id: string) {
  const { error } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      status: "SENT" satisfies OutboxStatus,
      sent_at: new Date().toISOString(),
      locked_until: null,
      last_error: null,
    })
    .eq("id", id);
  if (error) {
    throw new Error("ORDER_NOTIFICATION_OUTBOX_MARK_SENT_FAILED:" + error.message);
  }
}

async function markOutboxFailed(
  id: string,
  status: Extract<OutboxStatus, "PENDING" | "DEAD_LETTER">,
  attempts: number,
  error: unknown
) {
  const nextAttemptAt = new Date(Date.now() + Math.min(60, 2 ** attempts) * 60 * 1000);
  const message = error instanceof Error ? error.message : String(error);
  const { error: updateError } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      status,
      attempts,
      next_attempt_at: status === "DEAD_LETTER" ? null : nextAttemptAt.toISOString(),
      locked_until: null,
      last_error: message.slice(0, 1000),
    })
    .eq("id", id);
  if (updateError) {
    throw new Error("ORDER_NOTIFICATION_OUTBOX_MARK_FAILED_FAILED:" + updateError.message);
  }
}

async function sendOutboxRow(row: OutboxRow, requestId: string) {
  if (row.notification_type !== "ORDER_CONFIRMATION") {
    throw new Error("Unsupported notification type: " + row.notification_type);
  }

  const { data: orderRow, error: orderError } = await supabaseServer
    .from("orders")
    .select(
      "id, customer_name, email, phone, zip_code, prefecture, city, address, building, items, total, payment_method, store_visit_date"
    )
    .eq("id", row.order_id)
    .maybeSingle();

  if (orderError || !orderRow) {
    throw new Error(
      "ORDER_EMAIL_CONTEXT_FETCH_FAILED:" + (orderError?.message ?? "missing order")
    );
  }

  const order = orderRow as OrderEmailRow;
  let bankAccount: BankAccountRow | undefined;
  if (order.payment_method === "BANK_TRANSFER") {
    const { data, error } = await supabaseServer.from("bank_account").select("*").limit(1);
    if (error) {
      throw new Error("BANK_ACCOUNT_FETCH_FAILED:" + error.message);
    }
    bankAccount = (data?.[0] as BankAccountRow | undefined) ?? undefined;
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
    order.payment_method,
    typeof order.store_visit_date === "string" ? order.store_visit_date : undefined,
    bankAccount
  );

  if (!emailResult.sent) {
    logError("order_notification_outbox.email_failed", {
      requestId,
      route: "/api/crons/process-order-notifications",
      errorCode: emailResult.reason,
      context: { orderId: order.id, target: emailResult.target },
    });
    throw new Error("ORDER_NOTIFICATION_FAILED:" + emailResult.reason);
  }
}

export async function processOrderConfirmationOutboxForOrder(input: {
  orderId: string;
  requestId: string;
  outboxId?: string;
}) {
  const now = new Date().toISOString();
  let pendingQuery = supabaseServer
    .from("order_notification_outbox")
    .select("id, order_id, notification_type, attempts, max_attempts")
    .eq("order_id", input.orderId)
    .eq("notification_type", "ORDER_CONFIRMATION")
    .in("status", ["PENDING", "PROCESSING"])
    .or("next_attempt_at.is.null,next_attempt_at.lte." + now + ",locked_until.lte." + now)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(1);

  if (input.outboxId) {
    pendingQuery = pendingQuery.eq("id", input.outboxId);
  }

  const { data, error } = await pendingQuery;
  if (error) {
    logError("orders.notification_outbox.lookup_failed", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: "ORDER_NOTIFICATION_OUTBOX_LOOKUP_FAILED",
      context: { orderId: input.orderId, message: error.message },
    });
    return { processed: false, sent: false, reason: "LOOKUP_FAILED" as const, durableState: false };
  }

  const row = (data?.[0] ?? null) as OutboxRow | null;
  if (!row) {
    return { processed: false, sent: false, reason: "NO_PENDING_OUTBOX" as const };
  }

  let claimed = false;
  try {
    claimed = await claimOutboxRow(row.id, input.requestId);
  } catch (error) {
    logError("orders.notification_outbox.claim_failed", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: "ORDER_NOTIFICATION_OUTBOX_CLAIM_FAILED",
      context: { outboxId: row.id, message: error instanceof Error ? error.message : String(error) },
    });
    return {
      processed: false,
      sent: false,
      reason: "CLAIM_FAILED" as const,
      durableState: false,
    };
  }

  if (!claimed) {
    logWarn("orders.notification_outbox.claim_skipped", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: "ORDER_NOTIFICATION_OUTBOX_CLAIM_SKIPPED",
      context: { outboxId: row.id },
    });
    return { processed: false, sent: false, reason: "CLAIM_SKIPPED" as const };
  }

  try {
    await sendOutboxRow(row, input.requestId);
    await markOutboxSent(row.id);
    return { processed: true, sent: true, reason: "SENT" as const, durableState: true };
  } catch (error) {
    const attempts = Number(row.attempts ?? 0) + 1;
    const maxAttempts = Number(row.max_attempts ?? MAX_ATTEMPTS) || MAX_ATTEMPTS;
    const status = attempts >= maxAttempts ? "DEAD_LETTER" : "PENDING";

    try {
      await markOutboxFailed(row.id, status, attempts, error);
    } catch (markError) {
      logError("orders.notification_outbox.mark_failed_failed", {
        requestId: input.requestId,
        route: "/api/orders/[id]/actions",
        errorCode: "ORDER_NOTIFICATION_OUTBOX_MARK_FAILED_FAILED",
        context: {
          outboxId: row.id,
          message: markError instanceof Error ? markError.message : String(markError),
        },
      });
      return {
        processed: true,
        sent: false,
        reason: "MARK_FAILED_FAILED" as const,
        durableState: false,
      };
    }

    const reason = status === "DEAD_LETTER" ? ("DEAD_LETTER" as const) : ("ORDER_NOTIFICATION_FAILED" as const);
    logWarn("orders.notification_outbox.email_failed", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: reason,
      context: { outboxId: row.id, attempts, status },
    });
    return { processed: true, sent: false, reason, durableState: true };
  }
}

export async function processOrderNotificationOutbox(input: {
  requestId: string;
  limit?: number;
}) {
  const now = new Date().toISOString();
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .select("id, order_id, notification_type, attempts, max_attempts")
    .in("status", ["PENDING", "PROCESSING"])
    .or("next_attempt_at.is.null,next_attempt_at.lte." + now + ",locked_until.lte." + now)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    throw new Error("ORDER_NOTIFICATION_OUTBOX_SELECT_FAILED:" + error.message);
  }

  const rows = (data ?? []) as OutboxRow[];
  let sent = 0;
  let failed = 0;
  let deadLetter = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: row.order_id,
      outboxId: row.id,
      requestId: input.requestId,
    });

    if (result.sent) {
      sent += 1;
    } else if (result.reason === "DEAD_LETTER") {
      deadLetter += 1;
    } else if (result.processed) {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  logInfo("order_notification_outbox.processed", {
    requestId: input.requestId,
    route: "/api/crons/process-order-notifications",
    context: { scanned: rows.length, sent, failed, deadLetter, skipped },
  });

  return { scanned: rows.length, sent, failed, deadLetter, skipped };
}
