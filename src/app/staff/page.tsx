import Link from "next/link";
import { Prisma } from "@prisma/client";
import { isReservationSchemaNotReadyError } from "@/lib/reservation-compat";
import { getStaffDaySummary, getStaffServiceStatusLabel } from "@/lib/staff-summary";

export const dynamic = "force-dynamic";

function getPrivateBlockNotice(markerText: "夜のみ" | "昼のみ" | "終日貸切" | null) {
  if (markerText === "夜のみ") {
    return "ランチは貸切営業、ディナーは通常営業です。";
  }

  if (markerText === "昼のみ") {
    return "ディナーは貸切営業、ランチは通常営業です。";
  }

  if (markerText === "終日貸切") {
    return "ランチ・ディナーともに貸切営業です。";
  }

  return null;
}

function isDatabaseUrlMissingError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientInitializationError)) {
    return false;
  }

  return error.message.includes("Environment variable not found: DATABASE_URL");
}

export default async function StaffPage() {
  let summary: Awaited<ReturnType<typeof getStaffDaySummary>> | null = null;
  let summaryError: string | null = null;

  try {
    summary = await getStaffDaySummary();
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      summaryError =
        "予約系 migration が未適用のため、今日の営業状況を取得できません。migration 適用後に再確認してください。";
    } else if (isDatabaseUrlMissingError(error)) {
      summaryError =
        "DATABASE_URL が未設定のため、今日の営業状況を取得できません。.env.local に設定後、開発サーバーを再起動してください。";
    } else {
      throw error;
    }
  }

  const privateBlockNotice = summary ? getPrivateBlockNotice(summary.privateBlockMarkerText) : null;

  return (
    <div className="space-y-6 pt-20 pb-10">
      <header className="space-y-2">
        <p className="text-sm text-gray-600">スタッフページ</p>
        <h1 className="text-2xl font-semibold">現場ハブ</h1>
        <p className="text-sm text-gray-600">
          日次の営業状況を確認し、必要な管理画面へすぐ移動できます。
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-[#d7c2a4] bg-[#faf6ef] p-4 text-[#2f1b0f]">
          <p className="text-xs font-semibold tracking-wide text-[#7a5528]">今日の営業状況</p>
          {summaryError ? (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {summaryError}
            </p>
          ) : summary ? (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                日付: <span className="font-medium">{summary.date}</span>
              </p>
              <p>
                ステータス: <span className="font-semibold">{getStaffServiceStatusLabel(summary)}</span>
              </p>
              <p>
                通常予約: <span className="font-medium">{summary.normalReservationCount}組</span> /{" "}
                <span className="font-medium">{summary.normalPartyTotal}名</span>
              </p>
              <p>
                貸切件数: <span className="font-medium">{summary.privateBlockCount}件</span>
              </p>
              {privateBlockNotice ? (
                <p className="rounded-md bg-white px-3 py-2 text-[#8f2a2a]">{privateBlockNotice}</p>
              ) : null}
              {summary.businessDayNote ? (
                <p className="rounded-md bg-white px-3 py-2">営業メモ: {summary.businessDayNote}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-gray-500">予約管理への導線</p>
          <h2 className="mt-1 text-lg font-semibold text-gray-900">予約一覧を開く</h2>
          <p className="mt-1 text-sm text-gray-600">
            当日の予約確認、キャンセル処理、貸切解除はここから行います。
          </p>
          <Link
            href="/admin/reservations"
            className="mt-3 inline-flex rounded-md border border-[#8f6a39] px-3 py-2 text-sm font-medium text-[#6d4f29] hover:bg-[#f7f2ea]"
          >
            /admin/reservations
          </Link>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-gray-500">注文管理への導線</p>
          <h2 className="mt-1 text-lg font-semibold text-gray-900">注文ダッシュボードを開く</h2>
          <p className="mt-1 text-sm text-gray-600">
            注文一覧の確認とステータス更新、決済情報の確認に進みます。
          </p>
          <Link
            href="/dashboard/orders"
            className="mt-3 inline-flex rounded-md border border-[#8f6a39] px-3 py-2 text-sm font-medium text-[#6d4f29] hover:bg-[#f7f2ea]"
          >
            /dashboard/orders
          </Link>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold tracking-wide text-gray-500">休業日・貸切管理への導線</p>
          <h2 className="mt-1 text-lg font-semibold text-gray-900">休業日設定を開く</h2>
          <p className="mt-1 text-sm text-gray-600">
            休業日の設定や貸切運用メモの更新はこの画面で行います。
          </p>
          <Link
            href="/admin/business-days"
            className="mt-3 inline-flex rounded-md border border-[#8f6a39] px-3 py-2 text-sm font-medium text-[#6d4f29] hover:bg-[#f7f2ea]"
          >
            /admin/business-days
          </Link>
        </section>
      </div>
    </div>
  );
}
