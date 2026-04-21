import { supabaseServer } from "@/lib/supabase-server";
import { OrdersClient } from "./orders-client";

export const dynamic = "force-dynamic";

export default async function DashboardOrdersPage() {
  const [ordersResult, bankAccountResult] = await Promise.all([
    supabaseServer.from("orders").select("*").order("created_at", { ascending: false }),
    supabaseServer.from("bank_account").select("*").limit(1),
  ]);

  return (
    <OrdersClient
      initialOrders={ordersResult.error ? [] : ordersResult.data || []}
      initialBankAccount={
        bankAccountResult.error ? null : bankAccountResult.data?.[0] ? bankAccountResult.data[0] : null
      }
    />
  );
}
