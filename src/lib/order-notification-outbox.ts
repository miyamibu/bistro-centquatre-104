import { randomUUID } from "node:crypto";
import { sendOrderConfirmationEmail } from "@/lib/email";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { supabaseServer } from "@/lib/supabase-server";

const MAX_ATTEMPTS = 5;
const DELIVERY_TIMEOUT_MS = 7_000;
const LOCK_MINUTES = 5;

type OutboxStatus = "PENDING" | "PROCESSING" | "SENT" | "DEAD_LETTER";

type OutboxRow = {
  id: string;
  order_id: string;
  notification_type: string;
  attempts: number | null;
  max_attempts: number | null;
  claim_token: string | null;
  customer_sent_at: string | null;
  admin_sent_at: string | null;
  admin_skipped_at: string | null;
};

type DurableFailureReason = "CLAIM_LOST" | "DURABILITY_WRITE_FAILED";

class OutboxDurabilityError extends Error {
  constructor(
    readonly durableFailureReason: DurableFailureReason,
    message: string
  ) {
    super(message);
    this.name = "OutboxDurabilityError";
  }
}

class OrderCancelledSuppressed extends Error {
  constructor() {
    super("ORDER_CANCELLED");
    this.name = "OrderCancelledSuppressed";
  }
}

function isOutboxDurabilityError(error: unknown): error is OutboxDurabilityError {
  return error instanceof OutboxDurabilityError;
}

async function withDeliveryTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("ORDER_NOTIFICATION_DELIVERY_TIMEOUT")),
          DELIVERY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function requireFencedUpdate(
  operation: string,
  data: unknown,
  error: { message?: string } | null
) {
  if (error) {
    throw new OutboxDurabilityError(
      "DURABILITY_WRITE_FAILED",
      `${operation}:${error.message ?? "database update failed"}`
    );
  }
  if (!data) {
    throw new OutboxDurabilityError("CLAIM_LOST", `${operation}:claim lost`);
  }
}

type OrderEmailItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

type OrderEmailRow = {
  id: string;
  status: string;
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

const BANK_ACCOUNT_SELECT =
  "bank_name, branch_name, account_type, account_number, account_holder";

function buildClaimableOutboxFilter(now: string) {
  return [
    "and(status.eq.PENDING,next_attempt_at.is.null)",
    `and(status.eq.PENDING,next_attempt_at.lte.${now})`,
    `and(status.eq.PROCESSING,locked_until.lte.${now})`,
  ].join(",");
}

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
  const nowIso = now.toISOString();
  const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
  const claimToken = randomUUID();
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      status: "PROCESSING" satisfies OutboxStatus,
      claimed_at: nowIso,
      locked_until: lockedUntil,
      last_error: null,
      request_id: requestId,
      claim_token: claimToken,
    })
    .eq("id", id)
    .or(buildClaimableOutboxFilter(nowIso))
    .select("id, claim_token")
    .maybeSingle();

  if (error) {
    throw new Error("ORDER_NOTIFICATION_OUTBOX_CLAIM_FAILED:" + error.message);
  }
  if (!data || (data as { claim_token?: unknown }).claim_token !== claimToken) {
    return null;
  }
  return claimToken;
}

async function markOutboxCustomerSent(id: string, claimToken: string) {
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      customer_sent_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", id)
    .eq("claim_token", claimToken)
    .eq("status", "PROCESSING")
    .select("id")
    .maybeSingle();
  requireFencedUpdate("ORDER_NOTIFICATION_OUTBOX_MARK_CUSTOMER_SENT_FAILED", data, error);
}

async function markOutboxAdminSent(id: string, claimToken: string) {
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      admin_sent_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", id)
    .eq("claim_token", claimToken)
    .eq("status", "PROCESSING")
    .select("id")
    .maybeSingle();
  requireFencedUpdate("ORDER_NOTIFICATION_OUTBOX_MARK_ADMIN_SENT_FAILED", data, error);
}

async function markOutboxAdminSkipped(id: string, claimToken: string) {
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      admin_skipped_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", id)
    .eq("claim_token", claimToken)
    .eq("status", "PROCESSING")
    .select("id")
    .maybeSingle();
  requireFencedUpdate("ORDER_NOTIFICATION_OUTBOX_MARK_ADMIN_SKIPPED_FAILED", data, error);
}

async function markOutboxSent(id: string, claimToken: string) {
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      status: "SENT" satisfies OutboxStatus,
      sent_at: new Date().toISOString(),
      locked_until: null,
      claim_token: null,
      next_attempt_at: null,
      last_error: null,
    })
    .eq("id", id)
    .eq("claim_token", claimToken)
    .eq("status", "PROCESSING")
    .select("id")
    .maybeSingle();
  requireFencedUpdate("ORDER_NOTIFICATION_OUTBOX_MARK_SENT_FAILED", data, error);
}

async function suppressCancelledOrderOutbox(id: string, claimToken: string) {
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      status: "DEAD_LETTER" satisfies OutboxStatus,
      locked_until: null,
      claim_token: null,
      next_attempt_at: null,
      last_error: "ORDER_CANCELLED",
    })
    .eq("id", id)
    .eq("claim_token", claimToken)
    .eq("status", "PROCESSING")
    .select("id")
    .maybeSingle();
  requireFencedUpdate("ORDER_NOTIFICATION_OUTBOX_CANCEL_SUPPRESSION_FAILED", data, error);
}

async function markOutboxFailed(
  id: string,
  claimToken: string,
  status: Extract<OutboxStatus, "PENDING" | "DEAD_LETTER">,
  attempts: number,
  error: unknown
) {
  const nextAttemptAt = new Date(Date.now() + Math.min(60, 2 ** attempts) * 60 * 1000);
  const message = error instanceof Error ? error.message : String(error);
  const { data, error: updateError } = await supabaseServer
    .from("order_notification_outbox")
    .update({
      status,
      attempts,
      next_attempt_at: status === "DEAD_LETTER" ? null : nextAttemptAt.toISOString(),
      locked_until: null,
      claim_token: null,
      last_error: message.slice(0, 1000),
    })
    .eq("id", id)
    .eq("claim_token", claimToken)
    .eq("status", "PROCESSING")
    .select("id")
    .maybeSingle();
  if (updateError) {
    throw new Error("ORDER_NOTIFICATION_OUTBOX_MARK_FAILED_FAILED:" + updateError.message);
  }
  if (!data) {
    throw new Error("ORDER_NOTIFICATION_OUTBOX_MARK_FAILED_CLAIM_LOST");
  }
}

async function sendOutboxRow(row: OutboxRow, requestId: string, claimToken: string) {
  if (row.notification_type !== "ORDER_CONFIRMATION") {
    throw new Error("Unsupported notification type: " + row.notification_type);
  }

  const { data: orderRow, error: orderError } = await supabaseServer
    .from("orders")
    .select(
      "id, status, customer_name, email, phone, zip_code, prefecture, city, address, building, items, total, payment_method, store_visit_date"
    )
    .eq("id", row.order_id)
    .maybeSingle();

  if (orderError || !orderRow) {
    throw new Error(
      "ORDER_EMAIL_CONTEXT_FETCH_FAILED:" + (orderError?.message ?? "missing order")
    );
  }

  const order = orderRow as OrderEmailRow;
  if (order.status === "CANCELLED") {
    await suppressCancelledOrderOutbox(row.id, claimToken);
    throw new OrderCancelledSuppressed();
  }
  let bankAccount: BankAccountRow | undefined;
  if (order.payment_method === "BANK_TRANSFER") {
    const { data, error } = await supabaseServer
      .from("bank_account")
      .select(BANK_ACCOUNT_SELECT)
      .limit(1);
    if (error) {
      throw new Error("BANK_ACCOUNT_FETCH_FAILED:" + error.message);
    }
    bankAccount = (data?.[0] as BankAccountRow | undefined) ?? undefined;
  }

  const customerInfo = {
    name: String(order.customer_name),
    email: String(order.email),
    phone: String(order.phone),
    zipCode: String(order.zip_code),
    prefecture: String(order.prefecture),
    city: String(order.city),
    address: String(order.address),
    building: typeof order.building === "string" ? order.building : "",
  };
  const items = normalizeEmailItems(order.items);
  const total = Number(order.total ?? 0);
  const storeVisitDate =
    typeof order.store_visit_date === "string" ? order.store_visit_date : undefined;

  if (!row.customer_sent_at) {
    const customerResult = await sendOrderConfirmationEmail(
      customerInfo,
      items,
      total,
      order.payment_method,
      storeVisitDate,
      bankAccount,
      { target: "customer", idempotencyKey: `order-outbox/${row.id}` }
    );

    if (!customerResult.sent) {
      logError("order_notification_outbox.email_failed", {
        requestId,
        route: "/api/crons/process-order-notifications",
        errorCode: customerResult.reason,
        context: { orderId: order.id, target: customerResult.target },
      });
      throw new Error("ORDER_NOTIFICATION_FAILED:" + customerResult.reason);
    }

    await markOutboxCustomerSent(row.id, claimToken);
  }

  if (row.admin_sent_at || row.admin_skipped_at) return;

  const adminResult = await sendOrderConfirmationEmail(
    customerInfo,
    items,
    total,
    order.payment_method,
    storeVisitDate,
    bankAccount,
    { target: "admin", idempotencyKey: `order-outbox/${row.id}` }
  );

  if (!adminResult.sent) {
    logError("order_notification_outbox.email_failed", {
      requestId,
      route: "/api/crons/process-order-notifications",
      errorCode: adminResult.reason,
      context: { orderId: order.id, target: adminResult.target },
    });
    throw new Error("ORDER_NOTIFICATION_FAILED:" + adminResult.reason);
  }

  if (adminResult.adminSent) {
    await markOutboxAdminSent(row.id, claimToken);
  } else {
    await markOutboxAdminSkipped(row.id, claimToken);
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
    .select(
      "id, order_id, notification_type, attempts, max_attempts, claim_token, customer_sent_at, admin_sent_at, admin_skipped_at"
    )
    .eq("order_id", input.orderId)
    .eq("notification_type", "ORDER_CONFIRMATION")
    .or(buildClaimableOutboxFilter(now))
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

  let claimToken: string | null = null;
  try {
    claimToken = await claimOutboxRow(row.id, input.requestId);
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

  if (!claimToken) {
    logWarn("orders.notification_outbox.claim_skipped", {
      requestId: input.requestId,
      route: "/api/orders/[id]/actions",
      errorCode: "ORDER_NOTIFICATION_OUTBOX_CLAIM_SKIPPED",
      context: { outboxId: row.id },
    });
    return {
      processed: false,
      sent: false,
      reason: "CLAIM_SKIPPED" as const,
      durableState: false,
    };
  }

  try {
    await withDeliveryTimeout(sendOutboxRow(row, input.requestId, claimToken));
    await markOutboxSent(row.id, claimToken);
    return { processed: true, sent: true, reason: "SENT" as const, durableState: true };
  } catch (error) {
    if (error instanceof OrderCancelledSuppressed) {
      return {
        processed: true,
        sent: false,
        reason: "ORDER_CANCELLED" as const,
        durableState: true,
      };
    }
    if (isOutboxDurabilityError(error)) {
      logError("orders.notification_outbox.durability_failed", {
        requestId: input.requestId,
        route: "/api/orders/[id]/actions",
        errorCode: error.durableFailureReason,
        context: { outboxId: row.id, message: error.message },
      });
      return {
        processed: true,
        sent: false,
        reason: error.durableFailureReason,
        durableState: false,
      };
    }

    const attempts = Number(row.attempts ?? 0) + 1;
    const maxAttempts = Number(row.max_attempts ?? MAX_ATTEMPTS) || MAX_ATTEMPTS;
    const status = attempts >= maxAttempts ? "DEAD_LETTER" : "PENDING";

    try {
      await markOutboxFailed(row.id, claimToken, status, attempts, error);
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
  deadlineMs?: number;
}) {
  const now = new Date().toISOString();
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const deadlineMs = Math.max(250, Math.min(input.deadlineMs ?? 8_000, 15_000));
  const deadlineAt = Date.now() + deadlineMs;
  const { data, error } = await supabaseServer
    .from("order_notification_outbox")
    .select(
      "id, order_id, notification_type, attempts, max_attempts, claim_token, customer_sent_at, admin_sent_at, admin_skipped_at"
    )
    .or(buildClaimableOutboxFilter(now))
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
  let scanned = 0;
  let deadlineReached = false;

  for (const row of rows) {
    if (Date.now() >= deadlineAt) {
      deadlineReached = true;
      break;
    }
    scanned += 1;
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
    context: { scanned, sent, failed, deadLetter, skipped, deadlineReached },
  });

  return { scanned, sent, failed, deadLetter, skipped, deadlineReached };
}

export async function getOrderNotificationOutboxBacklog() {
  const now = new Date().toISOString();
  const { data, count, error } = await supabaseServer
    .from("order_notification_outbox")
    .select("created_at", { count: "exact" })
    .or(buildClaimableOutboxFilter(now))
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error("ORDER_NOTIFICATION_OUTBOX_BACKLOG_FAILED:" + error.message);
  }

  const oldest = data?.[0]?.created_at;
  return {
    backlog: count ?? data?.length ?? 0,
    oldestBacklogAt: typeof oldest === "string" ? new Date(oldest) : null,
  };
}
