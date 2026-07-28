import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";
import { DailyJournalPageClient } from "./page-client";

export const metadata: Metadata = createPageMetadata(
  "/daily-journal",
  "日々の出来事 | ビストロ サンキャトル 104",
  "仕込み、料理、季節のこと。ビストロ サンキャトル 104 の日々をお届けします。",
);

export default function DailyJournalPage() {
  return <DailyJournalPageClient />;
}
