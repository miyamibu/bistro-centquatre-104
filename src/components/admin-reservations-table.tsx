"use client";

import CancelButton from "@/components/cancel-button";
import { Button } from "@/components/ui/button";
import { getDayPeriodOperatingStatus } from "@/lib/admin-operating-status";
import type { AdminDayStatus } from "@/lib/admin-day-status";
import { Fragment, useId, useState } from "react";

export type AdminReservationTableRow = {
  id: string;
  date: string;
  servicePeriod: "LUNCH" | "DINNER";
  isPrivateBlock: boolean;
  arrivalTime: string | null;
  course: string | null;
  partySize: number;
  name: string;
  phone: string;
  note: string | null;
  isCancelled: boolean;
  statusLabel: string;
  lineStatus: string;
  lineReminderError: string | null;
};

type AdminReservationsTableProps = {
  selectedDate: string;
  reservations: AdminReservationTableRow[];
  dayStatus: AdminDayStatus | null;
  dataError?: string | null;
};

const TABLE_COLUMN_COUNT = 9;

function formatSelectedDate(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;

  const [, , month, day] = match;
  return `${Number(month)}月${Number(day)}日`;
}

function formatCourseName(course: string | null) {
  if (!course) return null;

  const withoutPrefix = course.replace(/^\s*(ランチ|ディナー)\s*[:：]\s*/, "").trim();
  return withoutPrefix || null;
}

function getStatusToneClass(tone: "warning" | "closed" | "private" | "normal") {
  if (tone === "warning") return "bg-amber-100 text-amber-900";
  if (tone === "closed") return "bg-gray-200 text-gray-800";
  if (tone === "private") return "bg-[#ffe7c2] text-[#6d3b00]";
  return "bg-gray-100 text-gray-700";
}

export default function AdminReservationsTable({
  selectedDate,
  reservations,
  dayStatus,
  dataError = null,
}: AdminReservationsTableProps) {
  const [openReservationIds, setOpenReservationIds] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const memoHeadingId = useId();
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const normalReservations = reservations.filter((reservation) => !reservation.isPrivateBlock);
  const filteredReservations =
    normalizedSearch.length === 0
      ? normalReservations
      : normalReservations.filter((reservation) =>
          [
            reservation.name,
            reservation.phone,
            reservation.course ?? "",
            reservation.arrivalTime ?? "",
            reservation.note ?? "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        );
  const sections = ([
    { key: "LUNCH", title: "ランチ" },
    { key: "DINNER", title: "ディナー" },
  ] as const).map((section) => {
    const rows = filteredReservations.filter(
      (reservation) => reservation.servicePeriod === section.key
    );
    const partyTotal = rows.reduce((sum, row) => sum + row.partySize, 0);
    const status = dayStatus ? getDayPeriodOperatingStatus(dayStatus, section.key) : null;
    const privateBlockId =
      section.key === "LUNCH"
        ? dayStatus?.lunch.privateBlock.id ?? null
        : dayStatus?.dinner.privateBlock.id ?? null;

    return {
      ...section,
      rows,
      partyTotal,
      status,
      privateBlockId,
    };
  });
  const visibleReservationCount = filteredReservations.length;
  const totalReservationCount = normalReservations.length;

  return (
    <div className="space-y-3">
      <div className="space-y-3 px-1">
        <h2 className="text-xl font-semibold text-gray-900 md:text-2xl">
          {formatSelectedDate(selectedDate)}
        </h2>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto] md:items-center">
          <label className="grid gap-1 text-sm text-gray-700">
            <span className="font-medium text-gray-900">氏名・電話番号で検索</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="例: 山田 / 090"
              className="h-10 rounded-md border border-[#d8cbb7] bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-[#2f1b0f]/15"
            />
          </label>
          <p className="text-sm text-gray-600">
            {visibleReservationCount}件表示 / 全{totalReservationCount}件
          </p>
        </div>
      </div>

      {dataError ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {dataError} 空の一覧とは区別して表示しています。
        </p>
      ) : null}

      <div className="space-y-4 md:hidden">
        {sections.map((section) => (
          <section key={`${section.key}-mobile`} className="card space-y-3 border-0 p-4 shadow-none">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900">{section.title}</h3>
                {section.status ? (
                  <span
                    className={[
                      "inline-flex rounded px-2 py-0.5 text-xs font-medium",
                      getStatusToneClass(section.status.tone),
                    ].join(" ")}
                  >
                    {section.status.label}
                  </span>
                ) : null}
                {section.status?.key === "NORMAL" ? (
                  <span className="text-xs text-gray-600">
                    {section.rows.length}組 / {section.partyTotal}名
                  </span>
                ) : null}
              </div>
              {section.privateBlockId ? (
                <CancelButton id={section.privateBlockId} label="貸切解除" requireOperatorName={true} />
              ) : null}
            </div>

            {dataError ? (
              <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
                取得失敗のため、この時間帯の件数は判定できません。
              </p>
            ) : section.rows.length === 0 ? (
              <p className="rounded-md bg-[#f8f5ef] px-4 py-3 text-sm text-gray-600">
                {section.privateBlockId
                  ? "通常予約はありません（貸切中）。"
                  : normalizedSearch
                  ? "検索条件に一致する予約はありません。"
                  : "この時間帯の予約はありません。"}
              </p>
            ) : (
              section.rows.map((reservation) => {
                const memoPanelId = `${memoHeadingId}-${reservation.id}`;
                const isMemoOpen = Boolean(openReservationIds[reservation.id]);
                const hasNote = Boolean(reservation.note);

                return (
                  <article key={`${reservation.id}-mobile`} className="rounded-xl border border-[#eadfce] bg-white px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-base font-semibold text-gray-900">{reservation.name}</p>
                      <span className="inline-flex rounded-full bg-[#f8f5ef] px-3 py-1 text-xs font-medium text-[#4a3121]">
                        {reservation.statusLabel}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-gray-700">
                      <p>来店目安: {reservation.arrivalTime ?? "-"}</p>
                      <p>コース: {formatCourseName(reservation.course) ?? "-"}</p>
                      <p>人数: {reservation.partySize}名</p>
                      <p>
                        電話: <a className="underline" href={`tel:${reservation.phone}`}>{reservation.phone}</a>
                      </p>
                      <p className="text-xs text-gray-500">
                        LINE通知: {reservation.lineStatus}
                        {reservation.lineReminderError ? (
                          <span className="ml-1 text-amber-700">[{reservation.lineReminderError}]</span>
                        ) : null}
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {hasNote ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-expanded={isMemoOpen}
                          aria-controls={memoPanelId}
                          onClick={() =>
                            setOpenReservationIds((current) => ({
                              ...current,
                              [reservation.id]: !current[reservation.id],
                            }))
                          }
                        >
                          {isMemoOpen ? "メモを閉じる" : "メモを見る"}
                        </Button>
                      ) : null}
                      <CancelButton
                        id={reservation.id}
                        disabled={reservation.isCancelled}
                        label="キャンセル"
                      />
                    </div>
                    {hasNote && isMemoOpen ? (
                      <div
                        id={memoPanelId}
                        className="mt-3 rounded-md border border-[#ead4bb] border-l-4 border-l-[#d4a96a] bg-[#fff8f0] px-4 py-3"
                      >
                        <div className="flex gap-3">
                          <span className="shrink-0 pt-0.5 text-xs font-medium text-gray-500">メモ</span>
                          <span className="whitespace-pre-wrap break-words text-sm text-gray-800">
                            {reservation.note}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}
          </section>
        ))}
      </div>

      <div className="hidden md:block">
        <div className="card overflow-x-auto border-0 shadow-none">
          <table className="w-full min-w-[820px]">
            <thead className="bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-4 py-2">来店目安</th>
                <th className="px-4 py-2">コース</th>
                <th className="px-4 py-2">人数</th>
                <th className="px-4 py-2">氏名</th>
                <th className="px-4 py-2">電話</th>
                <th className="px-4 py-2">状態</th>
                <th className="px-4 py-2">LINE</th>
                <th className="px-4 py-2">内部メモ</th>
                <th className="px-4 py-2">解除</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {sections.map((section) => (
                <Fragment key={section.key}>
                  <tr className="bg-[#f8f5ef]">
                    <th
                      colSpan={TABLE_COLUMN_COUNT}
                      scope="colgroup"
                      className="border-b border-[#e9dfd0] px-4 py-2 text-left text-sm font-semibold text-gray-700"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{section.title}</span>
                          {section.status ? (
                            <span
                              className={[
                                "inline-flex rounded px-2 py-0.5 text-xs font-medium",
                                getStatusToneClass(section.status.tone),
                              ].join(" ")}
                            >
                              {section.status.label}
                            </span>
                          ) : null}
                          {section.status?.key === "NORMAL" ? (
                            <span className="text-xs font-normal text-gray-600">
                              {section.rows.length}組 / {section.partyTotal}名
                            </span>
                          ) : null}
                        </div>

                        {section.privateBlockId ? (
                          <CancelButton
                            id={section.privateBlockId}
                            label="貸切解除"
                            requireOperatorName={true}
                          />
                        ) : null}
                      </div>
                    </th>
                  </tr>

                  {dataError ? (
                    <tr>
                      <td
                        colSpan={TABLE_COLUMN_COUNT}
                        className="border-b border-gray-100 bg-amber-50 px-4 py-5 text-sm text-amber-900"
                      >
                        取得失敗のため、この時間帯の件数は判定できません。
                      </td>
                    </tr>
                  ) : section.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={TABLE_COLUMN_COUNT}
                        className="border-b border-gray-100 px-4 py-5 text-sm text-gray-500"
                      >
                        {section.privateBlockId
                          ? "通常予約はありません（貸切中）。"
                          : normalizedSearch
                          ? "検索条件に一致する予約はありません。"
                          : "この時間帯の予約はありません。"}
                      </td>
                    </tr>
                  ) : (
                    section.rows.map((reservation) => {
                      const memoPanelId = `${memoHeadingId}-${reservation.id}`;
                      const isMemoOpen = Boolean(openReservationIds[reservation.id]);
                      const hasNote = Boolean(reservation.note);

                      return (
                        <Fragment key={reservation.id}>
                          <tr className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-4 py-2">{reservation.arrivalTime ?? "-"}</td>
                            <td className="px-4 py-2">{formatCourseName(reservation.course) ?? "-"}</td>
                            <td className="px-4 py-2">{`${reservation.partySize}名`}</td>
                            <td className="px-4 py-2">{reservation.name}</td>
                            <td className="px-4 py-2">{reservation.phone}</td>
                            <td className="px-4 py-2">{reservation.statusLabel}</td>
                            <td className="px-4 py-2 text-xs text-gray-500">
                              LINE通知: {reservation.lineStatus}
                              {reservation.lineReminderError ? (
                                <span className="ml-1 text-amber-700 block">{reservation.lineReminderError}</span>
                              ) : null}
                            </td>
                            <td className="px-4 py-2">
                              {hasNote ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  aria-expanded={isMemoOpen}
                                  aria-controls={memoPanelId}
                                  onClick={() =>
                                    setOpenReservationIds((current) => ({
                                      ...current,
                                      [reservation.id]: !current[reservation.id],
                                    }))
                                  }
                                >
                                  {isMemoOpen ? "閉じる" : "メモ"}
                                </Button>
                              ) : (
                                "-"
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <CancelButton
                                id={reservation.id}
                                disabled={reservation.isCancelled}
                                label="キャンセル"
                              />
                            </td>
                          </tr>

                          {hasNote && isMemoOpen ? (
                            <tr className="border-b border-gray-100 cursor-default bg-[#fffbf5]">
                              <td colSpan={TABLE_COLUMN_COUNT} className="px-4 py-3">
                                <div
                                  id={memoPanelId}
                                  className="rounded-md border border-[#ead4bb] border-l-4 border-l-[#d4a96a] bg-[#fff8f0] px-4 py-3"
                                >
                                  <div className="flex gap-3">
                                    <span className="shrink-0 pt-0.5 text-xs font-medium text-gray-500">
                                      メモ
                                    </span>
                                    <span className="whitespace-pre-wrap break-words text-sm text-gray-800">
                                      {reservation.note}
                                    </span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
