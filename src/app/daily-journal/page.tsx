import type { Metadata } from "next";
import { DailyJournalPageClient } from "./page-client";

export const metadata: Metadata = {
  title: "日々の出来事 | ビストロ サンキャトル 104",
  description: "仕込み、料理、季節のこと。ビストロ サンキャトル 104 の日々をお届けします。",
};

export default function DailyJournalPage() {
  return <DailyJournalPageClient />;
}
