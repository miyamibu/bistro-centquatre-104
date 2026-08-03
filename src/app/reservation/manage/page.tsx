import type { Metadata } from "next";
import { ReservationManageClient } from "@/components/reservation-manage-client";
import { NO_INDEX_METADATA } from "@/lib/seo";

export const metadata: Metadata = NO_INDEX_METADATA;

export default function ReservationManagePage() {
  return (
    <section className="px-0 pb-20 pt-[28px] md:pb-24 md:pt-[112px]">
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-3 text-[#2f1b0f]">
          <p className="text-xs uppercase tracking-[0.3em] text-[#b68c5a]">Reservation</p>
          <h1 className="text-3xl font-semibold md:text-4xl">予約内容の確認・キャンセル</h1>
          <p className="max-w-xl text-sm leading-7 text-[#4a3121] md:text-base">
            予約完了画面または確認メールの管理リンクから開いた場合に、予約内容を確認できます。
          </p>
          <p className="max-w-xl text-xs leading-6 text-[#6b5644] md:text-sm">
            Webからの無料キャンセルはご来店時刻の24時間前までです。期限後はお電話でご相談ください。現在、キャンセル料の設定・自動請求はありません。
          </p>
        </header>
        <ReservationManageClient />
      </div>
    </section>
  );
}
