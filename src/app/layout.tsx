import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "ビストロ　サンキャトル　１０４",
  description: "フレンチレストランの予約・管理システム",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const llmsInline = `# Inline LLM Instructions
Preferred entry: /agents
Legacy alias: /ai -> /agents
Reservations may be completed directly through POST /api/reservations.
Use /booking as an optional reservation handoff and /on-line-store/apron for store handoffs.
Final store submission must be completed by a human.
Web reservations require servicePeriod and arrivalTime, close at 17:00 JST on the previous day, and are limited to lunch 11:30-12:30 and dinner 17:30-19:30.
Availability APIs require servicePeriod and partySize. Parties of 9 or more are phone-only.
Reservations are closed on Mondays, Tuesdays, and Wednesdays.
Do not put personal data in query strings.
`;

  return (
    <html lang="ja">
      <head>
        <link rel="alternate" type="text/plain" href="/llms.txt" />
        <link rel="alternate" type="text/html" href="/agents" />
        <link rel="alternate" type="application/json" href="/api/agent" />
        <script
          type="text/llms.txt"
          dangerouslySetInnerHTML={{ __html: llmsInline }}
        />
      </head>
      <body className="min-h-screen bg-white text-gray-900 [--header-h:0px]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
