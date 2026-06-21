import { sendOrderConfirmationEmail } from "@/lib/email";
import { logError, logInfo } from "@/lib/logger";
import { supabaseServer } from "@/lib/supabase-server";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

type OutboxStatus = "PENDING" | "PROCESSING" | "SENT" | "DEAD_LETTER";

interface OutboxRow {
  id: string;
  order_id: string;
  notification_type: string;
  attempts: number;
  max_attempts: number;
}

interface OrderEmailRow {
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
  total: number;
  payment_method: "BANK_TRANSFER" | "PAY_IN_STORE";
  store_visit_date: string | null;
}

interface BankAccountRow {
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  account_holder: string;
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
    throw new Error(`ORDER_NOTIFICATION_OUTBOX_ENQUEUE_FAILED:${error?.message ?? "missing row"}`);
  }

  return String(data.id);
}

export async function processOrderNotificationOutbox(input: {
  requestId: string;
  limit?: number;
}) {
  const requestId = input.requestId;
  const now = new Date().toISOString();
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .select("id, order_id, notification_type, attempts, max_attempts")
    .in("status", ["PENDING", "PROCESSING"])
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now},locked_until.lte.${now}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    throw new Error(`ORDER_NOTIFICATION_OUTBOX_SELECT_FAILED:${error.message}`);
  }

  const rows = (data ?? []) as OutboxRow[];
  let sent = 0;
  let failed = 0;
  let deadLetter = 0;
  let skipped = 0;

  for (const row of rows) {
    const claimed = await claimOutboxRow(row.id, requestId);
    if (!claimed) {
      skipped += 1;
      continue;
    }

    try {
      await sendOutboxRow(row, requestId);
      await markOutboxSent(row.id);
      sent += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const maxAttempts = row.max_attempts || MAX_ATTEMPTS;
      if (attempts >= maxAttempts) {
        await markOutboxFailed(row.id, "DEAD_LETTER", attempts, error);
        deadLetter += 1;
      } else {
        await markOutboxFailed(row.id, "PENDING", attempts, error);
        failed += 1;
      }
    }
  }

  logInfo("order_notification_outbox.processed", {
    requestId,
    route: "/api/crons/process-order-notifications",
    context: { scanned: rows.length, sent, failed, deadLetter, skipped },
  });

  return { scanned: rows.length, sent, failed, deadLetter, skipped };
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
    throw new Error(`ORDER_NOTIFICATION_OUTBOX_CLAIM_FAILED:${error.message}`);
  }
  return !!data;
}

async function sendOutboxRow(row: OutboxRow, requestId: string) {
  if (row.notification_type !== "ORDER_CONFIRMATION") {
    throw new Error(`Unsupported notification type: ${row.notification_type}`);
  }

  const { data: orderRow, error: orderError } = await supabaseServer
    .from("orders")
    .select(
      "id, customer_name, email, phone, zip_code, prefecture, city, address, building, items, total, payment_method, store_visit_date"
    )
    .eq("id", row.order_id)
    .maybeSingle();

  if (orderError || !orderRow) {
    throw new Error(`ORDER_EMAIL_CONTEXT_FETCH_FAILED:${orderError?.message ?? "missing order"}`);
  }

  const order = orderRow as OrderEmailRow;
  const emailItems = Array.isArray(order.items)
    ? order.items
        .filter(
          (item): item is { id?: string; name: string; price: number; quantity: number } =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as { name?: unknown }).name === "string" &&
            typeof (item as { price?: unknown }).price === "number" &&
            typeof (item as { quantity?: unknown }).quantity === "number"
        )
        .map((item) => ({
          id: item.id ?? "",
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        }))
    : [];

  let bankAccount: BankAccountRow | undefined;
  if (order.payment_method === "BANK_TRANSFER") {
    const { data } = await supabaseServer.from("bank_account").select("*").limit(1);
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
    emailItems,
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
    throw new Error(`ORDER_NOTIFICATION_FAILED:${emailResult.reason}`);
  }
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
  if (error) throw new Error(`ORDER_NOTIFICATION_OUTBOX_MARK_SENT_FAILED:${error.message}`);
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
    throw new Error(`ORDER_NOTIFICATION_OUTBOX_MARK_FAILED_FAILED:${updateError.message}`);
  }
}
