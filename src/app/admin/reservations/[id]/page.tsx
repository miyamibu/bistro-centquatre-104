import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { StatusForm } from "@/components/status-form";
import { formatJst } from "@/lib/dates";
import { buildMockReservations } from "@/lib/admin-reservation-mock";
import { parseReservationNote } from "@/lib/reservation-note";
import {
  ensureReservationSchemaReady,
  findReservationByIdCompat,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";
import { getDaysInMonth, startOfMonth } from "date-fns";

export const dynamic = "force-dynamic";

export default async function AdminReservationDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let reservation = null;

  try {
    reservation = !process.env.DATABASE_URL
      ? (() => {
          const monthStart = startOfMonth(new Date(`${formatJst(new Date())}T00:00:00`));
          const monthDays = getDaysInMonth(monthStart);
          return buildMockReservations(monthStart, monthDays).find((row) => row.id === id) ?? null;
        })()
      : await (async () => {
          await ensureReservationSchemaReady(prisma);
          return findReservationByIdCompat(prisma, id);
        })();
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return (
        <div className="space-y-4 pt-20">
          <h1 className="text-2xl font-semibold">予約詳細</h1>
          <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            予約系 migration が未適用のため、予約詳細画面を一時停止しています。migration
            適用完了後に再開してください。
          </p>
        </div>
      );
    }

    throw error;
  }

  if (!reservation) {
    return <p className="text-gray-700">予約が見つかりませんでした。</p>;
  }
  const isPrivateBlock = reservation.reservationType === "PRIVATE_BLOCK";
  const { course, note } = parseReservationNote(reservation.note);

  return (
    <div className="space-y-4 pt-20">
      <Link className="text-brand-700 underline" href="/admin/reservations">
        ← 一覧に戻る
      </Link>
      <h1 className="text-2xl font-semibold">予約詳細</h1>
      <div className="card p-6 space-y-2 text-sm">
        <p>日付: {reservation.date}</p>
        <p>時間帯: {reservation.servicePeriod === "LUNCH" ? "ランチ" : "ディナー"}</p>
        <p>区分: {isPrivateBlock ? "貸切営業" : "通常予約"}</p>
        {isPrivateBlock ? (
          <>
            <p>コース: -</p>
            <p>人数: -</p>
            <p>来店目安: -</p>
            <p>氏名: 貸切</p>
            <p>電話: {reservation.phone === "-" ? "-" : reservation.phone}</p>
            <p className="whitespace-pre-wrap leading-6">内部メモ: {reservation.note ?? "なし"}</p>
          </>
        ) : (
          <>
            <p>コース: {course ?? "-"}</p>
            <p>人数: {reservation.partySize}名</p>
            <p>来店目安: {reservation.arrivalTime ?? "未入力"}</p>
            <p>氏名: {reservation.name}</p>
            <p>電話: {reservation.phone}</p>
            <p className="whitespace-pre-wrap leading-6">要望: {note ?? "なし"}</p>
          </>
        )}
        <p>ステータス: {reservation.status}</p>
        <p>作成: {reservation.createdAt.toISOString()}</p>
      </div>

      <div className="card p-4">
        <StatusForm
          id={reservation.id}
          current={reservation.status}
          isPrivateBlock={isPrivateBlock}
        />
      </div>
    </div>
  );
}
