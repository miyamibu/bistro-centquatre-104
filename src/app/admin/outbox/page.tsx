import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OutboxOperationsPanel } from "@/components/outbox-operations-panel";
import { getStaffAuth } from "@/lib/staff-auth";

export const metadata: Metadata = {
  title: "通知Outbox | ビストロ サンキャトル 104",
  description: "通知Outboxと無料schedulerの運用状態を確認します。",
};

export default async function AdminOutboxPage() {
  const staff = await getStaffAuth("ADMIN");
  if (!staff) redirect("/admin/login?error=staff_role_required&next=/admin/outbox");

  return (
    <main className="min-h-screen bg-[#fffdfa] px-4 py-8 text-[#2f1b0f]">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2 border-b border-[#eadfce] pb-5">
          <Link href="/admin" className="text-sm font-semibold text-[#8a6233] underline">管理画面一覧へ戻る</Link>
          <h1 className="text-2xl font-semibold sm:text-3xl">通知Outbox</h1>
          <p className="text-sm leading-6 text-[#6b5644]">個人ADMIN認証済みの操作です。表示と結果に予約・注文の個人情報は含めません。</p>
        </header>
        <OutboxOperationsPanel />
      </div>
    </main>
  );
}
