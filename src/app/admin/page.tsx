import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import {
  CalendarCheck,
  ClipboardList,
  ExternalLink,
  FilePenLine,
  LayoutDashboard,
  RefreshCcw,
  Store,
  Utensils,
} from "lucide-react";
import { StaffLogoutButton } from "@/components/staff-logout-button";

export const metadata: Metadata = {
  title: "管理画面一覧 | ビストロ サンキャトル 104",
  description: "お店側が使う管理画面のURLをまとめたページです。",
};

type ManagementLink = {
  title: string;
  href: Route;
  label: string;
  description: string;
  icon: typeof FilePenLine;
  primary: boolean;
};

const managementLinks: ManagementLink[] = [
  {
    title: "通知Outbox",
    href: "/admin/outbox" as Route,
    label: "通知運用",
    description: "scheduler heartbeat、滞留件数、手動再処理を確認します。",
    icon: RefreshCcw,
    primary: true,
  },
  {
    title: "日々の出来事を書く",
    href: "/admin/daily-journal",
    label: "ブログ・お知らせ",
    description: "お店の日々の出来事を作成、下書き保存、公開できます。",
    icon: FilePenLine,
    primary: true,
  },
  {
    title: "予約一覧",
    href: "/admin/reservations",
    label: "予約管理",
    description: "予約の確認、詳細表示、ステータス変更を行います。",
    icon: ClipboardList,
    primary: true,
  },
  {
    title: "休業日・貸切管理",
    href: "/admin/business-days",
    label: "営業日管理",
    description: "休業日の設定、貸切状態、日別の営業状況を確認できます。",
    icon: CalendarCheck,
    primary: true,
  },
  {
    title: "注文ダッシュボード",
    href: "/dashboard/orders",
    label: "オンラインストア",
    description: "注文一覧、ステータス、振込先情報などを確認します。",
    icon: LayoutDashboard,
    primary: false,
  },
  {
    title: "現場ハブ",
    href: "/staff",
    label: "当日確認",
    description: "今日の予約数や営業状況をすばやく確認できます。",
    icon: Store,
    primary: false,
  },
  {
    title: "お客さま向け出来事ページ",
    href: "/daily-journal",
    label: "公開ページ",
    description: "公開済みの記事がお客さまにどう見えるか確認できます。",
    icon: Utensils,
    primary: false,
  },
];

export default function AdminIndexPage() {
  const primaryLinks = managementLinks.filter((item) => item.primary);
  const secondaryLinks = managementLinks.filter((item) => !item.primary);

  return (
    <section className="min-h-screen bg-white pb-12 pt-8 text-[#2f1b0f]">
      <div className="mx-auto max-w-7xl space-y-8 px-4">
        <header className="border-b border-[#eadfce] pb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-[#6b5644]">お店側 管理メニュー</p>
              <h1 className="mt-2 text-2xl font-semibold md:text-3xl">管理画面一覧</h1>
            </div>
            <StaffLogoutButton />
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[#6b5644]">
            予約、営業日、日々の出来事、注文管理など、お店側で使う画面をここにまとめています。
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          {primaryLinks.map((item) => (
            <ManagementCard key={item.href} {...item} />
          ))}
        </div>

        <section className="space-y-4">
          <div className="border-b border-[#eadfce] pb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8a6233]">Other Links</p>
            <h2 className="mt-1 text-xl font-semibold">確認用リンク</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {secondaryLinks.map((item) => (
              <ManagementCard key={item.href} {...item} />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function ManagementCard({
  title,
  href,
  label,
  description,
  icon: Icon,
  primary,
}: (typeof managementLinks)[number]) {
  return (
    <Link
      href={href}
      className={`group flex min-h-[178px] flex-col justify-between rounded-2xl border p-5 shadow-sm transition ${
        primary
          ? "border-[#cfa96d]/45 bg-[#fffdfa] hover:border-[#8a6233] hover:bg-[#f8f1e7]"
          : "border-[#eadfce] bg-white hover:border-[#cfa96d] hover:bg-[#fffdfa]"
      }`}
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#cfa96d]/45 bg-white text-[#8a6233]">
            <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="rounded-full border border-[#cfa96d]/40 bg-white px-3 py-1 text-xs font-medium text-[#8a6233]">
            {label}
          </span>
        </div>
        <div>
          <h2 className="text-lg font-semibold leading-snug text-[#2f1b0f]">{title}</h2>
          <p className="mt-2 text-sm leading-7 text-[#6b5644]">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#eadfce] pt-3 text-sm font-semibold text-[#8a6233]">
        <span className="break-all">{href}</span>
        <ExternalLink
          size={16}
          strokeWidth={1.8}
          className="shrink-0 transition group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}
