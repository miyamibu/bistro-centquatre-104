import Link from "next/link";
import type { Route } from "next";
import { addDays, addMonths, format, getDay, getDaysInMonth, startOfMonth, subMonths } from "date-fns";
import { Prisma, ReservationStatus } from "@prisma/client";
import AdminReservationsTable, {
  type AdminReservationTableRow,
} from "@/components/admin-reservations-table";
import { getAdminReservationsPageData, normalizeAdminReservationDateInput } from "@/lib/admin-day-status";
import {
  getMonthDayOperatingStatus,
} from "@/lib/admin-operating-status";
import { formatJst } from "@/lib/dates";
import { parseReservationNote } from "@/lib/reservation-note";
import { getReservationStatusLabel } from "@/lib/reservation-labels";
import {
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";
import { RESERVATION_CONFIG } from "@/lib/reservation-config";

export const dynamic = "force-dynamic";

type ReservationWithLine = {
  lineUserId?: string | null;
  lineReminderSentAt?: Date | null;
  lineReminderStatus?: string | null;
  lineReminderError?: string | null;
};

function buildLineStatus(reservation: ReservationWithLine): string {
  if (!reservation.lineUserId) return "未連携";
  const status = reservation.lineReminderStatus;
  if (!status || status === "PENDING") return "連携済み（未送信）";
  if (status === "SENT") return "送信済み";
  if (status === "FAILED") return "通知失敗";
  if (status === "BLOCKED" || status === "SKIPPED_BLOCKED") return "通知ブロック";
  if (status === "SKIPPED_QUOTA") return "送信上限停止";
  return status;
}

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const CLOSED_WEEKDAY_SET = new Set<number>(RESERVATION_CONFIG.closedWeekdays);
const CLOSED_SELECTION_START_DATE = "2026-05-01";
type AdminReservationsPageData = Awaited<ReturnType<typeof getAdminReservationsPageData>>;

function isDatabaseUrlMissingError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientInitializationError)) {
    return false;
  }

  return error.message.includes("Environment variable not found: DATABASE_URL");
}

function getStatusToneClass(tone: "warning" | "closed" | "private" | "normal") {
  if (tone === "warning") return "bg-amber-100 text-amber-900";
  if (tone === "closed") return "bg-gray-200 text-gray-800";
  if (tone === "private") return "bg-[#ffe7c2] text-[#6d3b00]";
  return "bg-gray-100 text-gray-700";
}

function getCalendarBadgeLabel(
  statusKey: "CONFLICT" | "CLOSED" | "PRIVATE_BLOCKED" | "NORMAL"
): string | null {
  if (statusKey === "CONFLICT") return "競合";
  if (statusKey === "CLOSED") return "休業";
  if (statusKey === "PRIVATE_BLOCKED") return "貸切";
  return null;
}

export default async function AdminReservations({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const defaultDate = formatJst(new Date());
  const date = normalizeAdminReservationDateInput(resolvedSearchParams.date, defaultDate);
  const selectedDate = new Date(`${date}T00:00:00`);
  const calendarMonthStart = startOfMonth(selectedDate);
  const calendarMonthDays = getDaysInMonth(calendarMonthStart);
  const calendarFirstWeekday = getDay(calendarMonthStart);

  let reservations: AdminReservationsPageData["reservations"] = [];
  let dayStatus: AdminReservationsPageData["dayStatus"] | null = null;
  let monthDays: AdminReservationsPageData["monthDays"] = {};
  let dataError: string | null = null;

  try {
    const pageData = await getAdminReservationsPageData(date);
    reservations = pageData.reservations;
    dayStatus = pageData.dayStatus;
    monthDays = pageData.monthDays;
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return (
        <div className="space-y-4 pt-20 pb-10">
          <h1 className="text-2xl font-semibold">予約一覧</h1>
          <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            予約系 migration が未適用のため、予約管理画面を一時停止しています。migration
            適用完了後に再開してください。
          </p>
        </div>
      );
    }

    if (isDatabaseUrlMissingError(error)) {
      return (
        <div className="space-y-4 pt-20 pb-10">
          <h1 className="text-2xl font-semibold">予約一覧</h1>
          <p className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            DATABASE_URL が未設定のため、予約管理画面を表示できません。.env.local に設定後、
            開発サーバーを再起動してください。
          </p>
        </div>
      );
    }

    dataError = "予約データを取得できませんでした。時間をおいて再確認してください。";
  }

  const calendarCells = [
    ...Array.from({ length: calendarFirstWeekday }, () => null),
    ...Array.from({ length: calendarMonthDays }, (_, idx) => {
      const day = idx + 1;
      const dateObj = new Date(calendarMonthStart.getFullYear(), calendarMonthStart.getMonth(), day);
      const dateStr = format(dateObj, "yyyy-MM-dd");
      const daySummary = monthDays[dateStr];
      const isClosedBySchedule =
        dateStr >= CLOSED_SELECTION_START_DATE && CLOSED_WEEKDAY_SET.has(getDay(dateObj));
      const isSelectable = !isClosedBySchedule;

      return {
        dateStr,
        day,
        daySummary,
        isClosedBySchedule,
        isSelectable,
        lunchLastNames: (daySummary?.lunchReservationLastNames ?? []).slice(0, 2),
        dinnerLastNames: (daySummary?.dinnerReservationLastNames ?? []).slice(0, 2),
      };
    }),
  ];

  while (calendarCells.length % 7 !== 0) {
    calendarCells.push(null);
  }

  const buildDateHref = (dateStr: string): Route => {
    const params = new URLSearchParams();
    params.set("date", dateStr);
    return `/admin/reservations?${params.toString()}` as Route;
  };

  const buildMonthHref = (offset: number): Route => {
    const monthDate =
      offset < 0
        ? subMonths(calendarMonthStart, Math.abs(offset))
        : addMonths(calendarMonthStart, offset);
    return buildDateHref(format(monthDate, "yyyy-MM-01"));
  };

  const buildBusinessDayHref = (dateStr: string): Route => {
    const params = new URLSearchParams();
    params.set("date", dateStr);
    return `/admin/business-days?${params.toString()}` as Route;
  };

  const tomorrowDate = format(addDays(new Date(`${defaultDate}T00:00:00`), 1), "yyyy-MM-dd");
  const quickDateLinks = [
    { label: "今日", href: buildDateHref(defaultDate), active: date === defaultDate },
    { label: "明日", href: buildDateHref(tomorrowDate), active: date === tomorrowDate },
    ...(date !== defaultDate && date !== tomorrowDate
      ? [{ label: `${format(selectedDate, "M/d")} を表示中`, href: buildDateHref(date), active: true }]
      : []),
  ];

  const reservationRows: AdminReservationTableRow[] = reservations.map((reservation) => {
    const { course, note } = parseReservationNote(reservation.note);

    return {
      id: reservation.id,
      date: reservation.date,
      servicePeriod: reservation.servicePeriod,
      isPrivateBlock: reservation.reservationType === "PRIVATE_BLOCK",
      arrivalTime: reservation.arrivalTime,
      course,
      partySize: reservation.partySize,
      name: reservation.name,
      phone: reservation.phone,
      note,
      canCancel: reservation.status === ReservationStatus.CONFIRMED,
      statusLabel: getReservationStatusLabel(reservation.status),
      lineStatus: buildLineStatus(reservation),
      lineReminderError: reservation.lineReminderError ?? null,
    };
  });

  return (
    <div className="space-y-6 pt-20 pb-10">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <p className="text-sm text-gray-600">管理画面</p>
          <h1 className="text-2xl font-semibold">予約一覧</h1>
          <div className="flex flex-wrap gap-2">
            {quickDateLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className={[
                  "inline-flex h-9 items-center justify-center rounded-full px-4 text-sm transition",
                  link.active
                    ? "bg-[#2f1b0f] text-white"
                    : "border border-[#d8cbb7] bg-white text-[#4a3121] hover:bg-[#f8f5ef]",
                ].join(" ")}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 md:items-end">
          <Link href="/booking" className="text-brand-700 underline">
            公開予約フォーム
          </Link>
          <Link href={buildBusinessDayHref(date)} className="text-brand-700 underline">
            貸切設定はこちら
          </Link>
        </div>
      </header>

      <p className="text-sm text-gray-600">※通常は有効予約のみ表示しています。キャンセル済みは一覧上部から確認できます。</p>

      <AdminReservationsTable
        selectedDate={date}
        reservations={reservationRows}
        dayStatus={dayStatus}
        dataError={dataError}
      />

      <div className="card border-0 p-4 shadow-none overflow-x-auto">
        <div style={{ minWidth: "560px" }}>
          <div className="grid grid-cols-7 items-center gap-2">
            <Link
              href={buildMonthHref(-1)}
              aria-label="前の月へ"
              className="justify-self-center px-2 py-1 text-[35px] font-medium leading-none text-gray-700 transition hover:text-[#2f1b0f]"
            >
              ←
            </Link>
            <h2 className="col-span-5 text-center text-base font-semibold text-gray-800">
              月間予約カレンダー（{format(calendarMonthStart, "yyyy年M月")}）
            </h2>
            <Link
              href={buildMonthHref(1)}
              aria-label="次の月へ"
              className="justify-self-center px-2 py-1 text-[35px] font-medium leading-none text-gray-700 transition hover:text-[#2f1b0f]"
            >
              →
            </Link>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-gray-600">
            {DAY_LABELS.map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1">
            {calendarCells.map((cell, idx) => {
              if (!cell) {
                return <div key={`blank-${idx}`} className="min-h-[110px]" />;
              }

              const monthOperatingStatus = getMonthDayOperatingStatus(cell.daySummary);
              const isSelected = cell.dateStr === date;
              const isAllPrivate = Boolean(
                cell.daySummary?.hasLunchPrivateBlock && cell.daySummary?.hasDinnerPrivateBlock
              );
              const showCount = (cell.daySummary?.normalReservationCount ?? 0) > 0;
              const cellClass = [
                "relative block min-h-[110px] rounded border px-1.5 pt-0 pb-1.5",
                isSelected ? "border-[#2f1b0f]" : "border-gray-200",
                monthOperatingStatus.key === "CONFLICT"
                  ? "bg-amber-50"
                  : monthOperatingStatus.key === "CLOSED"
                  ? "bg-gray-50"
                  : isAllPrivate
                  ? "bg-[#fff3e3]"
                  : "bg-white",
                cell.daySummary?.hasLunchPrivateBlock && !isAllPrivate
                  ? "border-l-4 border-l-[#c77413]"
                  : "",
                cell.daySummary?.hasDinnerPrivateBlock && !isAllPrivate
                  ? "border-r-4 border-r-[#c77413]"
                  : "",
                cell.isSelectable
                  ? "transition hover:bg-[#f7f4ee]"
                  : "cursor-not-allowed opacity-70",
              ].join(" ");
              const badgeLabel = getCalendarBadgeLabel(monthOperatingStatus.key);
              const content = (
                <>
                  <div className="absolute left-1.5 top-1 flex items-start gap-1 leading-none">
                    <span className="text-[18px] font-semibold leading-none text-gray-900">{cell.day}</span>
                    {showCount ? (
                      <span className="text-[11px] leading-none text-gray-500">
                        {cell.daySummary?.normalReservationCount}組
                      </span>
                    ) : null}
                  </div>

                  {badgeLabel ? (
                    <span
                      className={[
                        "absolute right-1.5 top-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium",
                        getStatusToneClass(monthOperatingStatus.tone),
                      ].join(" ")}
                    >
                      {badgeLabel}
                    </span>
                  ) : null}

                  {cell.isClosedBySchedule && !badgeLabel ? (
                    <span className="absolute right-1.5 top-1 inline-flex rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-800">
                      定休
                    </span>
                  ) : null}

                  <div className="pt-6">
                    <div className="grid grid-cols-2 gap-x-4 text-[11px] font-semibold leading-none">
                      <p className="whitespace-nowrap text-right text-[#c77413]">ランチ</p>
                      <p className="whitespace-nowrap text-left text-[#1e3a5f]">ディナー</p>
                    </div>

                    <div className="mt-1 grid grid-cols-2 gap-x-4 text-[12px] leading-tight">
                      <div className="space-y-0.5 text-right">
                        {cell.daySummary?.hasLunchPrivateBlock ? (
                          <p className="text-[#8f2a2a]">貸切</p>
                        ) : null}
                        {cell.lunchLastNames.map((name) => (
                          <p key={name} className="truncate font-semibold text-gray-700">
                            {name}
                          </p>
                        ))}
                      </div>
                      <div className="space-y-0.5 text-left">
                        {cell.daySummary?.hasDinnerPrivateBlock ? (
                          <p className="text-[#8f2a2a]">貸切</p>
                        ) : null}
                        {cell.dinnerLastNames.map((name) => (
                          <p key={name} className="truncate font-semibold text-gray-700">
                            {name}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              );

              if (!cell.isSelectable) {
                return (
                  <div
                    key={cell.dateStr}
                    aria-disabled="true"
                    className={cellClass}
                  >
                    {content}
                  </div>
                );
              }

              return (
                <Link
                  key={cell.dateStr}
                  href={buildDateHref(cell.dateStr)}
                  aria-current={isSelected ? "date" : undefined}
                  className={cellClass}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
