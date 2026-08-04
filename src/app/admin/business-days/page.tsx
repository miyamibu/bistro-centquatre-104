"use client";

import { addDays, addMonths, format, getDay, getDaysInMonth, subDays } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getDayOperatingStatus } from "@/lib/admin-operating-status";

type ServicePeriodKey = "LUNCH" | "DINNER";

type DayStatusPeriod = {
  privateBlock: {
    active: boolean;
    id: string | null;
  };
  reservations: {
    count: number;
    partyTotal: number;
    names: string[];
    lastNames: string[];
    memoEntries: Array<{
      lastName: string;
      note: string | null;
    }>;
  };
};

type DayStatusResponse = {
  date: string;
  isClosed: boolean;
  note: string | null;
  permissions?: {
    canManageBusinessDays: boolean;
  };
  lunch: DayStatusPeriod;
  dinner: DayStatusPeriod;
};

type MonthDaySummary = {
  date: string;
  isClosed: boolean;
  hasLunchPrivateBlock: boolean;
  hasDinnerPrivateBlock: boolean;
  normalReservationCount: number;
  lunchReservationLastNames: string[];
  dinnerReservationLastNames: string[];
  normalReservationLastNames: string[];
  hasConflict: boolean;
};

type MonthStatusResponse = {
  month: string;
  days: Record<string, MonthDaySummary>;
  permissions?: {
    canManageBusinessDays: boolean;
  };
};

type BusinessConfirmMode =
  | "CLOSE_WITH_PRIVATE_BLOCK"
  | "OPEN_WITH_PRIVATE_BLOCK"
  | "CLOSE_WITH_RESERVATIONS";

type LatestRequestState = {
  generation: number;
  controller: AbortController | null;
};

const dayLabels = ["日", "月", "火", "水", "木", "金", "土"] as const;

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map((value) => Number(value));
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day);
}

function toDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function toMonthKey(date: Date) {
  return format(date, "yyyy-MM");
}

function formatDateWithWeekday(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return dateKey;
  return `${format(parsed, "yyyy年M月d日")}（${dayLabels[getDay(parsed)]}）`;
}

function getPreviewNames(names: string[]) {
  const normalizedNames = names.map((name) => name.trim()).filter(Boolean);
  const shown = normalizedNames.slice(0, 3);
  const restCount = Math.max(0, normalizedNames.length - shown.length);
  return {
    text: shown.length > 0 ? shown.join("・") : "予約あり",
    restCount,
  };
}

function toDisplayLastName(lastName: string) {
  const normalized = lastName.trim();
  return normalized || "予約";
}

function buildAdminDayAriaLabel(date: string, summary: MonthDaySummary | undefined) {
  const parts = [formatDateWithWeekday(date)];
  if (!summary) {
    parts.push("状態未取得");
    return parts.join(" ");
  }
  if (summary.isClosed) parts.push("休業");
  if (summary.hasLunchPrivateBlock) parts.push("ランチ貸切");
  if (summary.hasDinnerPrivateBlock) parts.push("ディナー貸切");
  if (summary.normalReservationCount > 0) parts.push(`通常予約 ${summary.normalReservationCount}組`);
  if (summary.hasConflict) parts.push("要確認");
  if (parts.length === 1) parts.push("通常営業");
  return parts.join(" ");
}

export default function BusinessDaysPage() {
  const initialMonth = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }, []);

  const [calendarMonth, setCalendarMonth] = useState(initialMonth);
  const [selectedDate, setSelectedDate] = useState("");
  const [monthDays, setMonthDays] = useState<Record<string, MonthDaySummary>>({});
  const [dayStatus, setDayStatus] = useState<DayStatusResponse | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [dayLoading, setDayLoading] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);

  const [isClosedDraft, setIsClosedDraft] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [businessSaving, setBusinessSaving] = useState(false);
  const [businessConfirmMode, setBusinessConfirmMode] = useState<BusinessConfirmMode | null>(null);
  const [businessConflictCount, setBusinessConflictCount] = useState(0);
  const [canManageBusinessDays, setCanManageBusinessDays] = useState(false);

  const [releasePeriod, setReleasePeriod] = useState<ServicePeriodKey | null>(null);
  const [operatorName, setOperatorName] = useState("");
  const [periodLoading, setPeriodLoading] = useState<ServicePeriodKey | null>(null);
  const [detailOpenByPeriod, setDetailOpenByPeriod] = useState<Record<ServicePeriodKey, boolean>>({
    LUNCH: false,
    DINNER: false,
  });

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const monthRequestRef = useRef<LatestRequestState>({ generation: 0, controller: null });
  const dayRequestRef = useRef<LatestRequestState>({ generation: 0, controller: null });

  const monthKey = useMemo(() => toMonthKey(calendarMonth), [calendarMonth]);

  const fetchMonthStatus = useCallback(async (targetMonth: string) => {
    monthRequestRef.current.controller?.abort();
    const requestGeneration = monthRequestRef.current.generation + 1;
    const controller = new AbortController();
    monthRequestRef.current = { generation: requestGeneration, controller };
    setMonthLoading(true);
    setMonthError(null);

    try {
      const res = await fetch(`/api/admin/day-status?month=${targetMonth}`, {
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as MonthStatusResponse | { error?: string } | null;
      if (monthRequestRef.current.generation !== requestGeneration) return;
      if (!res.ok || !data || !("days" in data)) {
        setMonthError((data && "error" in data && typeof data.error === "string" ? data.error : null) ?? "月次状態の取得に失敗しました。");
        return;
      }

      setMonthDays(data.days ?? {});
      if (data.permissions) {
        setCanManageBusinessDays(data.permissions.canManageBusinessDays);
      }
    } catch {
      if (controller.signal.aborted || monthRequestRef.current.generation !== requestGeneration) return;
      setMonthError("月次状態の取得に失敗しました。");
    } finally {
      if (monthRequestRef.current.generation === requestGeneration) {
        monthRequestRef.current.controller = null;
        setMonthLoading(false);
      }
    }
  }, []);

  const fetchDayStatus = useCallback(async (date: string) => {
    dayRequestRef.current.controller?.abort();
    const requestGeneration = dayRequestRef.current.generation + 1;
    const controller = new AbortController();
    dayRequestRef.current = { generation: requestGeneration, controller };
    setDayLoading(true);
    setDayError(null);
    setBusinessConfirmMode(null);
    setReleasePeriod(null);
    setOperatorName("");
    setDetailOpenByPeriod({ LUNCH: false, DINNER: false });

    try {
      const res = await fetch(`/api/admin/day-status?date=${date}`, {
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as DayStatusResponse | { error?: string } | null;
      if (dayRequestRef.current.generation !== requestGeneration) return;
      if (!res.ok || !data || !("lunch" in data)) {
        setDayError((data && "error" in data && typeof data.error === "string" ? data.error : null) ?? "日次状態の取得に失敗しました。");
        setDayStatus(null);
        return;
      }

      setDayStatus(data);
      if (data.permissions) {
        setCanManageBusinessDays(data.permissions.canManageBusinessDays);
      }
      setIsClosedDraft(data.isClosed);
      setNoteDraft(data.note ?? "");
    } catch {
      if (controller.signal.aborted || dayRequestRef.current.generation !== requestGeneration) return;
      setDayError("日次状態の取得に失敗しました。");
      setDayStatus(null);
    } finally {
      if (dayRequestRef.current.generation === requestGeneration) {
        dayRequestRef.current.controller = null;
        setDayLoading(false);
      }
    }
  }, []);

  const refreshStatus = useCallback(
    async (date: string) => {
      await Promise.all([fetchDayStatus(date), fetchMonthStatus(toMonthKey(parseDateKey(date) ?? calendarMonth))]);
    },
    [calendarMonth, fetchDayStatus, fetchMonthStatus]
  );

  useEffect(() => {
    fetchMonthStatus(monthKey);
  }, [fetchMonthStatus, monthKey]);

  useEffect(() => {
    if (!selectedDate) {
      setDayStatus(null);
      setDayError(null);
      return;
    }
    fetchDayStatus(selectedDate);
  }, [fetchDayStatus, selectedDate]);

  useEffect(() => {
    return () => {
      monthRequestRef.current.generation += 1;
      monthRequestRef.current.controller?.abort();
      dayRequestRef.current.generation += 1;
      dayRequestRef.current.controller?.abort();
    };
  }, []);

  const calendarCells = useMemo(() => {
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const firstWeekday = getDay(firstDay);
    const dayCount = getDaysInMonth(firstDay);

    return [
      ...Array.from({ length: firstWeekday }, () => null),
      ...Array.from({ length: dayCount }, (_, index) => {
        const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), index + 1);
        return toDateKey(date);
      }),
    ];
  }, [calendarMonth]);

  const selectedDateParsed = useMemo(
    () => (selectedDate ? parseDateKey(selectedDate) : null),
    [selectedDate]
  );

  const hasAnyPrivateBlock = Boolean(
    dayStatus?.lunch.privateBlock.active || dayStatus?.dinner.privateBlock.active
  );
  const activePrivateBlockLabel = useMemo(() => {
    if (!dayStatus) return "貸切";

    const labels: string[] = [];
    if (dayStatus.lunch.privateBlock.active) labels.push("ランチ貸切");
    if (dayStatus.dinner.privateBlock.active) labels.push("ディナー貸切");

    if (labels.length === 2) return "ランチ・ディナー貸切";
    if (labels.length === 1) return labels[0];
    return "貸切";
  }, [dayStatus]);

  const businessConfirmCandidate: BusinessConfirmMode | null = useMemo(() => {
    if (!dayStatus || !hasAnyPrivateBlock) return null;
    if (isClosedDraft && !dayStatus.isClosed) return "CLOSE_WITH_PRIVATE_BLOCK";
    if (!isClosedDraft && dayStatus.isClosed) return "OPEN_WITH_PRIVATE_BLOCK";
    return null;
  }, [dayStatus, hasAnyPrivateBlock, isClosedDraft]);

  const badgeStatus = dayStatus ? getDayOperatingStatus(dayStatus) : null;

  async function createPrivateBlock(servicePeriod: ServicePeriodKey) {
    if (!selectedDate || !canManageBusinessDays) return;
    setPeriodLoading(servicePeriod);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/private-block", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          date: selectedDate,
          servicePeriod,
        }),
      });
      const data = (await res.json().catch(() => null)) as { summary?: string; error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "貸切設定に失敗しました。");
        return;
      }

      setMessage(data?.summary ?? "貸切を設定しました。");
      await refreshStatus(selectedDate);
    } catch {
      setError("貸切設定に失敗しました。");
    } finally {
      setPeriodLoading(null);
    }
  }

  async function releasePrivateBlock(servicePeriod: ServicePeriodKey) {
    if (!selectedDate || !dayStatus || !canManageBusinessDays) return;
    const reservationId =
      servicePeriod === "LUNCH" ? dayStatus.lunch.privateBlock.id : dayStatus.dinner.privateBlock.id;
    if (!reservationId) return;

    const trimmedOperatorName = operatorName.trim();
    if (!trimmedOperatorName) {
      setError("担当者名を入力してください。");
      return;
    }
    const reason = window.prompt("貸切解除の理由を入力してください")?.trim();
    if (!reason) {
      setError("解除理由を入力してください。");
      return;
    }

    setPeriodLoading(servicePeriod);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/reservations/${reservationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          status: "CANCELLED",
          operatorName: trimmedOperatorName,
          reason,
          expectedDate: selectedDate,
          expectedServicePeriod: servicePeriod,
          expectedReservationType: "PRIVATE_BLOCK",
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "貸切解除に失敗しました。");
        return;
      }

      setMessage(`${servicePeriod === "LUNCH" ? "ランチ" : "ディナー"}の貸切を解除しました。`);
      setReleasePeriod(null);
      setOperatorName("");
      await refreshStatus(selectedDate);
    } catch {
      setError("貸切解除に失敗しました。");
    } finally {
      setPeriodLoading(null);
    }
  }

  async function saveBusinessDay(force = false) {
    if (!selectedDate || !canManageBusinessDays) return;

    if (!force && businessConfirmCandidate) {
      setBusinessConfirmMode(businessConfirmCandidate);
      return;
    }

    setBusinessSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/business-days", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          date: selectedDate,
          isClosed: isClosedDraft,
          note: noteDraft.trim() ? noteDraft.trim() : null,
          force,
          reason: force && isClosedDraft ? noteDraft.trim() || null : null,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
        reservationCount?: number;
      } | null;
      if (!res.ok) {
        if (data?.code === "BUSINESS_DAY_CONFIRMED_RESERVATIONS") {
          setBusinessConflictCount(data.reservationCount ?? 0);
          setBusinessConfirmMode("CLOSE_WITH_RESERVATIONS");
        }
        setError(data?.error ?? "営業状態の保存に失敗しました。");
        return;
      }

      setBusinessConfirmMode(null);
      setMessage("営業状態を保存しました。");
      await refreshStatus(selectedDate);
    } catch {
      setError("営業状態の保存に失敗しました。");
    } finally {
      setBusinessSaving(false);
    }
  }

  function selectDate(date: string) {
    const parsed = parseDateKey(date);
    setSelectedDate(date);
    if (parsed) {
      setCalendarMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    }
  }

  function shiftSelectedDate(offset: number) {
    if (!selectedDateParsed) return;
    const shifted = offset < 0 ? subDays(selectedDateParsed, Math.abs(offset)) : addDays(selectedDateParsed, offset);
    selectDate(toDateKey(shifted));
  }

  function renderPeriodRow(servicePeriod: ServicePeriodKey) {
    if (!dayStatus || !selectedDate) return null;

    const period = servicePeriod === "LUNCH" ? dayStatus.lunch : dayStatus.dinner;
    const label = servicePeriod === "LUNCH" ? "ランチ" : "ディナー";
    const hasReservations = period.reservations.count > 0;
    const isBusy = periodLoading === servicePeriod;
    const reasonId = `${servicePeriod.toLowerCase()}-reason`;
    const previewNames = getPreviewNames(period.reservations.lastNames);
    const isDetailsOpen = detailOpenByPeriod[servicePeriod];

    return (
      <div className="rounded-md border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900">{label}</p>
            <span
              className={[
                "inline-flex rounded px-2 py-0.5 text-xs",
                period.privateBlock.active
                  ? "bg-[#ffe7c2] text-[#6d3b00]"
                  : "bg-gray-100 text-gray-700",
              ].join(" ")}
            >
              {period.privateBlock.active ? "貸切中" : "空き"}
            </span>
          </div>

          {period.privateBlock.active ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBusy || !canManageBusinessDays}
              onClick={() => {
                setReleasePeriod((current) => (current === servicePeriod ? null : servicePeriod));
                setOperatorName("");
                setError(null);
              }}
            >
              {isBusy ? "処理中..." : "解除する"}
            </Button>
          ) : hasReservations ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled
                aria-describedby={reasonId}
              >
                設定不可
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-expanded={isDetailsOpen}
                onClick={() =>
                  setDetailOpenByPeriod((current) => ({
                    ...current,
                    [servicePeriod]: !current[servicePeriod],
                  }))
                }
              >
                {isDetailsOpen ? "閉じる" : "詳細"}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBusy || !canManageBusinessDays}
              onClick={() => createPrivateBlock(servicePeriod)}
            >
              {isBusy ? "処理中..." : "貸切設定する"}
            </Button>
          )}
        </div>

        {period.privateBlock.active && releasePeriod === servicePeriod ? (
          <div className="mt-3 space-y-2 rounded-md border border-[#d8c19c] bg-[#fff9ef] p-3">
            <p className="text-xs text-gray-700">{label}貸切を解除します。</p>
            <label htmlFor={`${servicePeriod.toLowerCase()}-operator-name`} className="grid gap-1 text-xs text-gray-700">
              担当者名
              <input
                id={`${servicePeriod.toLowerCase()}-operator-name`}
                value={operatorName}
                onChange={(event) => setOperatorName(event.target.value)}
                className="h-9 rounded border border-gray-300 px-2 text-sm"
                placeholder="担当者名を入力"
                maxLength={80}
              />
            </label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setReleasePeriod(null)}>
                キャンセル
              </Button>
              <Button type="button" size="sm" disabled={isBusy || !canManageBusinessDays} onClick={() => releasePrivateBlock(servicePeriod)}>
                {isBusy ? "処理中..." : "解除する"}
              </Button>
            </div>
          </div>
        ) : null}

        {!period.privateBlock.active && hasReservations ? (
          <div id={reasonId} className="mt-2 space-y-1 text-xs text-[#7a3f11]">
            <p>
              ※予約があります: {previewNames.text}
              {previewNames.restCount > 0 ? `（他${previewNames.restCount}件）` : ""} 計
              {period.reservations.partyTotal}名
            </p>
            {isDetailsOpen ? (
              <div className="space-y-1 rounded-md border border-[#e3c6ab] bg-[#fff8f0] p-2 text-[#6f3b13]">
                {period.reservations.memoEntries.map((entry, index) => (
                  <p key={`${servicePeriod}-memo-${index}`}>
                    {toDisplayLastName(entry.lastName)}: {entry.note ? entry.note : "-"}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-20 pb-10">
      <header className="text-center">
        <h1 className="text-2xl font-semibold">貸切設定画面</h1>
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr),minmax(0,1fr)]">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="overflow-x-auto">
            <div style={{ minWidth: "620px" }}>
              <div className="mb-3 grid grid-cols-7 items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setCalendarMonth((prev) => addMonths(prev, -1))}>
                  ←
                </Button>
                <h2 className="col-span-5 text-center text-base font-semibold text-gray-900">
                  {format(calendarMonth, "yyyy年M月")}
                </h2>
                <Button type="button" variant="outline" size="sm" onClick={() => setCalendarMonth((prev) => addMonths(prev, 1))}>
                  →
                </Button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-600">
                {dayLabels.map((label) => (
                  <div key={label}>{label}</div>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-7 gap-1">
                {calendarCells.map((date, index) => {
                  if (!date) {
                    return <div key={`blank-${index}`} className="min-h-[110px]" />;
                  }

                  const summary = monthDays[date];
                  const lunchLastNames = (summary?.lunchReservationLastNames ?? [])
                    .map((lastName) => lastName.trim())
                    .filter(Boolean);
                  const dinnerLastNames = (summary?.dinnerReservationLastNames ?? [])
                    .map((lastName) => lastName.trim())
                    .filter(Boolean);
                  const isSelected = date === selectedDate;
                  const isClosed = summary?.isClosed ?? false;
                  const isConflict = summary?.hasConflict ?? false;
                  const isAllPrivate = summary?.hasLunchPrivateBlock && summary?.hasDinnerPrivateBlock;

                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => selectDate(date)}
                      className={[
                        "relative min-h-[110px] rounded border px-1.5 pt-0 pb-1.5 text-left transition",
                        isSelected ? "border-[#2f1b0f]" : "border-gray-200 hover:bg-[#faf7f2]",
                        isConflict
                          ? "bg-gray-100"
                          : isClosed
                          ? "bg-gray-50"
                          : isAllPrivate
                          ? "bg-[#fff3e3]"
                          : "bg-white",
                        summary?.hasLunchPrivateBlock && !isAllPrivate ? "border-l-4 border-l-[#c77413]" : "",
                        summary?.hasDinnerPrivateBlock && !isAllPrivate ? "border-r-4 border-r-[#c77413]" : "",
                      ].join(" ")}
                      aria-label={buildAdminDayAriaLabel(date, summary)}
                      aria-pressed={isSelected}
                    >
                      <div className="absolute left-1/2 top-1 flex -translate-x-1/2 items-start gap-1 leading-none">
                        <span className="text-sm font-semibold leading-none text-gray-900">
                          {Number(date.slice(-2))}
                        </span>
                        {summary && summary.normalReservationCount > 0 ? (
                          <span className="text-[10px] leading-none text-gray-500">
                            {summary.normalReservationCount}組
                          </span>
                        ) : null}
                      </div>

                      <div className="pt-5">
                        <div className="absolute inset-x-1.5 top-5 grid grid-cols-2 gap-x-0.5 text-[9px] font-medium leading-none">
                          <p className="whitespace-nowrap text-[#c77413]">ランチ</p>
                          <p className="whitespace-nowrap text-right text-[#1e3a5f]">ディナー</p>
                        </div>

                        {isClosed ? <p className="mt-0.5 text-center text-[10px] text-[#8f2a2a]">休業</p> : null}

                        <div className="mt-0.5 grid grid-cols-2 gap-x-0.5 text-[10px] leading-tight">
                          <div className="space-y-0.5">
                            {summary?.hasLunchPrivateBlock ? <p className="text-[#8f2a2a]">貸切</p> : null}
                            {lunchLastNames.map((lastName, nameIndex) => (
                              <p key={`${date}-lunch-name-${nameIndex}`} className="truncate text-gray-700">
                                {toDisplayLastName(lastName)}
                              </p>
                            ))}
                          </div>
                          <div className="space-y-0.5 text-right">
                            {summary?.hasDinnerPrivateBlock ? <p className="text-[#8f2a2a]">貸切</p> : null}
                            {dinnerLastNames.map((lastName, nameIndex) => (
                              <p key={`${date}-dinner-name-${nameIndex}`} className="truncate text-gray-700">
                                {toDisplayLastName(lastName)}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {monthLoading ? (
            <p role="status" aria-live="polite" aria-busy="true" className="mt-3 text-xs text-gray-600">
              月次状態を読み込み中です...
            </p>
          ) : null}
          {monthError ? (
            <p role="alert" aria-live="assertive" className="mt-3 text-xs text-red-700">
              {monthError}
            </p>
          ) : null}
        </section>

        <section className="rounded-lg border border-gray-200 bg-[#fdfbf8] p-4">
          <div className="mb-3 flex items-center justify-between md:hidden">
            <Button type="button" size="sm" variant="outline" disabled={!selectedDate} onClick={() => shiftSelectedDate(-1)}>
              ← 前日
            </Button>
            <p className="text-sm font-medium text-gray-800">
              {selectedDate ? formatDateWithWeekday(selectedDate) : "日付未選択"}
            </p>
            <Button type="button" size="sm" variant="outline" disabled={!selectedDate} onClick={() => shiftSelectedDate(1)}>
              翌日 →
            </Button>
          </div>

          {!selectedDate ? (
            <div className="rounded-md border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-600">
              <p className="font-medium text-gray-800">日付を選択してください</p>
              <p className="mt-1">カレンダーから日付をクリックすると、その日の営業状態を確認・変更できます。</p>
            </div>
          ) : dayLoading ? (
            <p role="status" aria-live="polite" aria-busy="true" className="text-sm text-gray-600">
              日次状態を読み込み中です...
            </p>
          ) : dayError ? (
            <p role="alert" aria-live="assertive" className="text-sm text-red-700">
              {dayError}
            </p>
          ) : dayStatus ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm text-gray-600">{formatDateWithWeekday(dayStatus.date)}</p>
                <p className="text-sm font-semibold text-gray-900">現在の状態</p>
                {badgeStatus ? (
                  <div
                    className={[
                      "inline-flex rounded-md px-3 py-2 text-sm font-medium",
                      badgeStatus.tone === "private"
                        ? "bg-[#ffe7c2] text-[#6d3b00]"
                        : badgeStatus.tone === "closed"
                        ? "bg-gray-200 text-gray-800"
                        : badgeStatus.tone === "warning"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-gray-100 text-gray-800",
                    ].join(" ")}
                  >
                    {badgeStatus.label}
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                {renderPeriodRow("LUNCH")}
                {renderPeriodRow("DINNER")}
              </div>

              <div className="rounded-md border border-gray-200 bg-white p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={isClosedDraft}
                    disabled={!canManageBusinessDays}
                    onChange={(event) => {
                      setIsClosedDraft(event.target.checked);
                      setBusinessConfirmMode(null);
                    }}
                  />
                  この日は全日休業にする
                </label>

                {!canManageBusinessDays ? (
                  <p className="rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700">
                    営業状態・貸切の変更はADMIN権限が必要です。現在の状態は確認できます。
                  </p>
                ) : null}

                <label htmlFor="business-day-note" className="grid gap-1 text-sm text-gray-800">
                  営業メモ（スタッフ内部用）
                  <textarea
                    id="business-day-note"
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    className="min-h-[84px] rounded border border-gray-300 px-2 py-2 text-sm"
                    placeholder="例: 店舗都合により営業時間変更"
                    maxLength={300}
                  />
                </label>

                {businessConfirmMode === "CLOSE_WITH_PRIVATE_BLOCK" ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
                    <p>
                      {activePrivateBlockLabel}
                      が設定されています。全日休業を設定しても貸切レコードは残ります（優先順位: 休業 &gt; 貸切）。
                    </p>
                    <p>オンライン予約は非表示になりますが、管理画面からは引き続き確認できます。</p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setBusinessConfirmMode(null)}>
                        キャンセル
                      </Button>
                      <Button type="button" size="sm" disabled={businessSaving || !canManageBusinessDays} onClick={() => saveBusinessDay(true)}>
                        {businessSaving ? "処理中..." : "このまま休業設定する"}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {businessConfirmMode === "OPEN_WITH_PRIVATE_BLOCK" ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
                    <p>
                      {activePrivateBlockLabel}
                      が設定されたまま休業を解除します。解除後も該当時間帯は「貸切中」です。
                    </p>
                    <p>貸切を解除したい場合は上の「解除する」ボタンを使ってください。</p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setBusinessConfirmMode(null)}>
                        キャンセル
                      </Button>
                      <Button type="button" size="sm" disabled={businessSaving || !canManageBusinessDays} onClick={() => saveBusinessDay(true)}>
                        {businessSaving ? "処理中..." : "休業のみ解除する"}
                      </Button>
                    </div>
                  </div>
                ) : null}

                {businessConfirmMode === "CLOSE_WITH_RESERVATIONS" ? (
                  <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900 space-y-2">
                    <p>
                      確定済み予約が{businessConflictCount}件あります。強制休業しても予約は自動取消されず、既存予約として残ります。
                    </p>
                    <p>強制休業する場合は、上の営業メモに理由を入力してください。</p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setBusinessConfirmMode(null)}>
                        キャンセル
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={businessSaving || !canManageBusinessDays || !noteDraft.trim()}
                        onClick={() => saveBusinessDay(true)}
                      >
                        {businessSaving ? "処理中..." : "理由を記録して強制休業"}
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <Button
                    type="button"
                    disabled={businessSaving || !canManageBusinessDays}
                    onClick={() => saveBusinessDay(false)}
                  >
                    {businessSaving ? "保存中..." : "保存する"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {message ? (
            <p role="status" aria-live="polite" className="mt-3 text-sm text-green-700">
              {message}
            </p>
          ) : null}
          {error ? (
            <p role="alert" aria-live="assertive" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
