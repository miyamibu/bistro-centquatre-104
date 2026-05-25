import type { Metadata } from "next";
import { AdminDailyJournalClient } from "./page-client";

export const metadata: Metadata = {
  title: "日々の出来事 管理 | ビストロ サンキャトル 104",
  description: "お店側が日々の出来事を編集・公開する管理画面です。",
};

export default function AdminDailyJournalPage() {
  return <AdminDailyJournalClient />;
}
