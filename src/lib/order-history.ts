import { supabaseServer } from "@/lib/supabase-server";

type TerminalOrderStatus = "SHIPPED" | "CANCELLED";

type OrderHistorySource = "admin" | "cron";

interface OrderRowForHistory {
  id: string;
  customer_name: string;
  email: string;
  phone: string;
  zip_code: string;
  prefecture: string;
  city: string;
  address: string;
  building: string | null;
  payment_method: "BANK_TRANSFER" | "PAY_IN_STORE" | null;
  payment_reference: string | null;
  items: unknown;
  total: number;
  store_visit_date: string | null;
  status: string;
  paid_at: string | null;
  shipped_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  version: number;
  created_at: string;
}

export function toOrderHistoryRecord(order: OrderRowForHistory) {
  if (order.status !== "SHIPPED" && order.status !== "CANCELLED") {
    return null;
  }

  const terminalStatus = order.status as TerminalOrderStatus;
  const deletedAt =
    terminalStatus === "SHIPPED"
      ? order.shipped_at ?? new Date().toISOString()
      : order.canceled_at ?? new Date().toISOString();

  return {
    id: order.id,
    customer_name: order.customer_name,
    email: order.email,
    phone: order.phone,
    zip_code: order.zip_code,
    prefecture: order.prefecture,
    city: order.city,
    address: order.address,
    building: order.building,
    payment_method: order.payment_method,
    payment_reference: order.payment_reference,
    items: order.items,
    total: order.total,
    store_visit_date: order.store_visit_date,
    status: terminalStatus,
    paid_at: order.paid_at,
    shipped_at: order.shipped_at,
    canceled_at: order.canceled_at,
    cancel_reason: order.cancel_reason,
    version: order.version,
    created_at: order.created_at,
    deleted_at: deletedAt,
  };
}

export async function archiveOrderHistoryByOrderId(input: {
  orderId: string;
  source: OrderHistorySource;
  requestId: string;
}) {
  const { data, error } = await supabaseServer
    .from("orders")
    .select(
      "id, customer_name, email, phone, zip_code, prefecture, city, address, building, payment_method, payment_reference, items, total, store_visit_date, status, paid_at, shipped_at, canceled_at, cancel_reason, version, created_at"
    )
    .eq("id", input.orderId)
    .maybeSingle();

  if (error) {
    throw new Error(`ORDER_HISTORY_SOURCE_READ_FAILED:${error.message}`);
  }

  if (!data) {
    throw new Error("ORDER_HISTORY_SOURCE_NOT_FOUND");
  }

  const record = toOrderHistoryRecord(data as OrderRowForHistory);
  if (!record) {
    return { archived: false as const, reason: "NOT_TERMINAL" as const };
  }

  const { error: upsertError } = await supabaseServer.from("order_history").upsert([record], {
    onConflict: "id",
    ignoreDuplicates: true,
  });

  if (upsertError) {
    throw new Error(`ORDER_HISTORY_ARCHIVE_FAILED:${upsertError.message}`);
  }

  return {
    archived: true as const,
    status: record.status,
    source: input.source,
    requestId: input.requestId,
  };
}
