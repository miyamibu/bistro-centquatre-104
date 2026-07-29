import { supabaseServer } from "@/lib/supabase-server";
import { OrdersClient } from "./orders-client";

export const dynamic = "force-dynamic";

const ORDER_LIST_LIMIT = 100;
const ORDER_LIST_SELECT =
  "id, customer_name, email, phone, zip_code, prefecture, city, address, building, payment_method, items, total, store_visit_date, status, version, created_at";

export default async function DashboardOrdersPage() {
  const [ordersResult, bankAccountResult] = await Promise.all([
    supabaseServer
      .from("orders")
      .select(ORDER_LIST_SELECT)
      .order("created_at", { ascending: false })
      .range(0, ORDER_LIST_LIMIT - 1),
    supabaseServer.from("bank_account").select("*").limit(1),
  ]);

  return (
    <OrdersClient
      initialOrders={ordersResult.error ? [] : ordersResult.data || []}
      initialOrdersError={ordersResult.error ? "注文一覧を取得できませんでした。時間をおいて再確認してください。" : null}
      initialBankAccount={
        bankAccountResult.error ? null : bankAccountResult.data?.[0] ? bankAccountResult.data[0] : null
      }
      initialBankAccountError={
        bankAccountResult.error
          ? "銀行情報を取得できませんでした。設定状態を確認できません。"
          : null
      }
    />
  );
}
