"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDefaultArrivalTimeForCourse,
  getPrivateBlockMarkerText,
  getReservationSlotGroups,
  inferReservationServicePeriodFromArrivalTime,
  inferReservationServicePeriodFromCourse,
  isArrivalTimeAllowed,
} from "@/lib/booking-rules";
import type { AvailabilityResponse, MonthlyAvailabilityMap } from "@/lib/availability";
import { CONTACT_PHONE_DISPLAY, CONTACT_MESSAGE, CONTACT_TEL_LINK } from "@/lib/contact";
import {
  getReservationCoursesForServicePeriod,
  RESERVATION_CONFIG,
  type ReservationServicePeriodKey,
} from "@/lib/reservation-config";
import {
  addJstMonths,
  formatJstMonth,
  formatJstMonthDay,
  getDaysInJstMonth,
  getJstDateKey,
  getJstDayOfMonth,
  getJstMonthKey,
  getJstWeekday,
  getJstYearMonthParts,
  jstDateFromString,
  startOfJstMonth,
  todayJst,
} from "@/lib/dates";
import {
  sanitizeArrivalTime,
  sanitizeCourse,
  sanitizeDate,
  sanitizePartySize,
  sanitizeServicePeriod,
} from "@/lib/reservation-form-defaults";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  defaultDate: string;
  afterAvailabilityNote?: string[];
  initialDate?: string;
  initialServicePeriod?: string;
  initialPartySize?: string;
  initialCourse?: string;
  initialArrivalTime?: string;
  initialAvailability?: AvailabilityResponse | null;
  initialMonthlyAvailabilityByPeriod?: Record<ReservationServicePeriodKey, MonthlyAvailabilityMap>;
}

interface SubmittedReservationSummary {
  date: string;
  servicePeriod: ReservationServicePeriodKey;
  partySize: number;
  arrivalTime: string;
  course: string;
  name: string;
  phone: string;
}

type AvailabilityState = Omit<AvailabilityResponse, "reason"> & {
  reason: AvailabilityResponse["reason"] | "CHECKING" | "ERROR";
};
type MonthlyAvailabilityByPeriod = Record<ReservationServicePeriodKey, MonthlyAvailabilityMap>;

const checkingAvailability: AvailabilityState = {
  webBookable: false,
  reason: "CHECKING",
  callPhone: CONTACT_PHONE_DISPLAY,
  callMessage: CONTACT_MESSAGE,
};

const nonSelectableReasons = new Set([
  "BEFORE_OPENING",
  "OUT_OF_RANGE",
  "CLOSED",
  "PRIVATE_BLOCK",
  "SAME_DAY_BLOCKED",
  "CUTOFF_PASSED",
]);
const servicePeriods: ReservationServicePeriodKey[] = ["LUNCH", "DINNER"];

export function ReserveForm({
  defaultDate,
  afterAvailabilityNote,
  initialDate,
  initialServicePeriod,
  initialPartySize,
  initialCourse,
  initialArrivalTime,
  initialAvailability,
  initialMonthlyAvailabilityByPeriod,
}: Props) {
  const initialResolvedDate = sanitizeDate(initialDate, defaultDate);
  const selectedInitialServicePeriod = sanitizeServicePeriod(
    initialServicePeriod,
    initialCourse,
    initialArrivalTime
  );
  const selectedInitialCourse = sanitizeCourse(initialCourse, selectedInitialServicePeriod);
  const selectedInitialArrivalTime = sanitizeArrivalTime(
    initialArrivalTime,
    selectedInitialServicePeriod
  );
  const selectedInitialPartySize = sanitizePartySize(initialPartySize);
  const initialAvailabilityKey = initialAvailability
    ? `${initialResolvedDate}:${selectedInitialServicePeriod}:${selectedInitialPartySize}`
    : null;
  const initialMonthlyKey = initialMonthlyAvailabilityByPeriod
    ? `${getJstMonthKey(startOfJstMonth(jstDateFromString(initialResolvedDate)))}:${selectedInitialPartySize}`
    : null;

  const [form, setForm] = useState({
    date: initialResolvedDate,
    partySize: selectedInitialPartySize,
    course: selectedInitialCourse,
    arrivalTime: selectedInitialArrivalTime,
    lastName: "",
    firstName: "",
    phone: "",
    note: "",
  });
  const [availability, setAvailability] = useState<AvailabilityState>(
    initialAvailability ?? checkingAvailability
  );
  const [resolvedAvailabilityKey, setResolvedAvailabilityKey] = useState<string | null>(
    initialAvailabilityKey
  );
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittedReservation, setSubmittedReservation] =
    useState<SubmittedReservationSummary | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() =>
    startOfJstMonth(jstDateFromString(initialResolvedDate))
  );
  const [monthlyAvailabilityByPeriod, setMonthlyAvailabilityByPeriod] =
    useState<MonthlyAvailabilityByPeriod>({
      LUNCH: {},
      DINNER: {},
      ...(initialMonthlyAvailabilityByPeriod ?? {}),
    });
  const [resolvedMonthlyAvailabilityKey, setResolvedMonthlyAvailabilityKey] = useState<
    string | null
  >(initialMonthlyKey);

  const partyMin = 1;
  const partyMax = RESERVATION_CONFIG.maxPartySize;
  const selectedDate = useMemo(() => jstDateFromString(form.date), [form.date]);
  const today = useMemo(() => todayJst(), []);
  const currentServicePeriod = useMemo(
    () =>
      inferReservationServicePeriodFromArrivalTime(form.arrivalTime) ??
      inferReservationServicePeriodFromCourse(form.course) ??
      selectedInitialServicePeriod,
    [form.arrivalTime, form.course, selectedInitialServicePeriod]
  );
  const activeServicePeriod = currentServicePeriod;
  const selectableServicePeriodsForSelectedDate = useMemo(() => {
    const selectablePeriods = servicePeriods.filter((period) => {
      const daily = monthlyAvailabilityByPeriod[period][form.date] ?? null;
      return daily == null || !nonSelectableReasons.has(daily.reason);
    });

    return selectablePeriods.length > 0 ? selectablePeriods : servicePeriods;
  }, [form.date, monthlyAvailabilityByPeriod]);
  const courseOptions = useMemo(
    () => getReservationCoursesForServicePeriod(currentServicePeriod),
    [currentServicePeriod]
  );
  const arrivalTimeOptions = useMemo(
    () =>
      getReservationSlotGroups()
        .filter((group) => selectableServicePeriodsForSelectedDate.includes(group.key))
        .flatMap((group) =>
          group.slots.map((time) => ({
            value: time,
            label: `${group.label} ${time}`,
          }))
        ),
    [selectableServicePeriodsForSelectedDate]
  );
  const selectedDateServiceStatus = useMemo(() => {
    const lunch = monthlyAvailabilityByPeriod.LUNCH[form.date] ?? null;
    const dinner = monthlyAvailabilityByPeriod.DINNER[form.date] ?? null;
    const privateBlockMarkerText = getPrivateBlockMarkerText(lunch?.reason, dinner?.reason);

    return {
      lunch,
      dinner,
      privateBlockMarkerText,
    };
  }, [form.date, monthlyAvailabilityByPeriod]);
  const dayLabels = ["日", "月", "火", "水", "木", "金", "土"] as const;

  async function loadDailyAvailability(
    date: string,
    servicePeriod: ReservationServicePeriodKey,
    partySize: number
  ) {
    const params = new URLSearchParams({
      date,
      servicePeriod,
      partySize: String(partySize),
    });
    const response = await fetch(`/api/availability?${params.toString()}`);
    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      throw new Error("DAILY_AVAILABILITY_FETCH_FAILED");
    }

    return data as AvailabilityState;
  }

  async function loadMonthlyAvailability(
    monthStartDate: Date,
    servicePeriod: ReservationServicePeriodKey,
    partySize: number
  ) {
    const params = new URLSearchParams({
      month: getJstMonthKey(startOfJstMonth(monthStartDate)),
      servicePeriod,
      partySize: String(partySize),
    });
    const response = await fetch(`/api/availability/monthly?${params.toString()}`);
    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.days) {
      throw new Error("MONTHLY_AVAILABILITY_FETCH_FAILED");
    }

    return data.days as MonthlyAvailabilityMap;
  }

  function getDateAvailability(date: string, servicePeriod: ReservationServicePeriodKey) {
    return monthlyAvailabilityByPeriod[servicePeriod][date] ?? null;
  }

  function getSelectableFallbackPeriod(date: string, currentPeriod: ReservationServicePeriodKey) {
    return servicePeriods.find((period) => {
      if (period === currentPeriod) {
        return false;
      }

      const daily = getDateAvailability(date, period);
      return daily != null && !nonSelectableReasons.has(daily.reason);
    });
  }

  function switchToServicePeriod(period: ReservationServicePeriodKey) {
    const nextCourse = getReservationCoursesForServicePeriod(period)[0]?.value ?? "";
    const nextArrivalTime = getDefaultArrivalTimeForCourse(undefined, period);

    setForm((prev) => ({
      ...prev,
      course: nextCourse,
      arrivalTime: nextArrivalTime,
    }));
  }

  function updateDate(date: string) {
    updateField("date", date);

    const currentDaily = getDateAvailability(date, currentServicePeriod);
    if (currentDaily != null && !nonSelectableReasons.has(currentDaily.reason)) {
      return;
    }

    const fallbackPeriod = getSelectableFallbackPeriod(date, currentServicePeriod);
    if (fallbackPeriod) {
      switchToServicePeriod(fallbackPeriod);
    }
  }

  useEffect(() => {
    if (Number.isNaN(selectedDate.getTime())) {
      return;
    }

    const nextMonth = startOfJstMonth(selectedDate);
    setCalendarMonth((prev) =>
      getJstMonthKey(prev) === getJstMonthKey(nextMonth) ? prev : nextMonth
    );
  }, [selectedDate]);

  useEffect(() => {
    const fallbackCourse = courseOptions[0]?.value ?? "";
    const nextCourse = courseOptions.some((option) => option.value === form.course)
      ? form.course
      : fallbackCourse;
    const nextArrivalTime = isArrivalTimeAllowed(form.arrivalTime, undefined, currentServicePeriod)
      ? form.arrivalTime
      : getDefaultArrivalTimeForCourse(undefined, currentServicePeriod);

    if (nextCourse === form.course && nextArrivalTime === form.arrivalTime) {
      return;
    }

    setForm((prev) => ({
      ...prev,
      course: nextCourse,
      arrivalTime: nextArrivalTime,
    }));
  }, [courseOptions, currentServicePeriod, form.arrivalTime, form.course]);

  useEffect(() => {
    let active = true;
    const requestKey = `${form.date}:${activeServicePeriod}:${form.partySize}`;
    if (resolvedAvailabilityKey === requestKey) {
      return;
    }

    setAvailability((prev) => ({ ...prev, reason: "CHECKING" }));

    loadDailyAvailability(form.date, activeServicePeriod, form.partySize)
      .then((data) => {
        if (!active) return;
        setAvailability(data);
        setResolvedAvailabilityKey(requestKey);
      })
      .catch(() => {
        if (!active) return;
        setAvailability({ ...checkingAvailability, reason: "ERROR" });
        setResolvedAvailabilityKey(null);
      });

    return () => {
      active = false;
    };
  }, [activeServicePeriod, form.date, form.partySize, resolvedAvailabilityKey]);

  useEffect(() => {
    let active = true;
    const requestKey = `${getJstMonthKey(startOfJstMonth(calendarMonth))}:${form.partySize}`;
    if (resolvedMonthlyAvailabilityKey === requestKey) {
      return;
    }

    Promise.all(
      servicePeriods.map(async (period) => [
        period,
        await loadMonthlyAvailability(calendarMonth, period, form.partySize),
      ])
    )
      .then((entries) => {
        if (!active) return;
        setMonthlyAvailabilityByPeriod({
          LUNCH: {},
          DINNER: {},
          ...Object.fromEntries(entries),
        } as MonthlyAvailabilityByPeriod);
        setResolvedMonthlyAvailabilityKey(requestKey);
      })
      .catch(() => {
        if (!active) return;
        setMonthlyAvailabilityByPeriod({
          LUNCH: {},
          DINNER: {},
        });
        setResolvedMonthlyAvailabilityKey(null);
      });

    return () => {
      active = false;
    };
  }, [calendarMonth, form.partySize, resolvedMonthlyAvailabilityKey]);

  useEffect(() => {
    const currentDaily = monthlyAvailabilityByPeriod[currentServicePeriod][form.date] ?? null;
    if (currentDaily == null || !nonSelectableReasons.has(currentDaily.reason)) {
      return;
    }

    const fallbackPeriod = servicePeriods.find((period) => {
      if (period === currentServicePeriod) {
        return false;
      }

      const daily = monthlyAvailabilityByPeriod[period][form.date] ?? null;
      return daily != null && !nonSelectableReasons.has(daily.reason);
    });
    if (fallbackPeriod) {
      const nextCourse = getReservationCoursesForServicePeriod(fallbackPeriod)[0]?.value ?? "";
      const nextArrivalTime = getDefaultArrivalTimeForCourse(undefined, fallbackPeriod);

      setForm((prev) => ({
        ...prev,
        course: nextCourse,
        arrivalTime: nextArrivalTime,
      }));
    }
  }, [currentServicePeriod, form.date, monthlyAvailabilityByPeriod]);

  function updateField<T extends keyof typeof form>(key: T, value: (typeof form)[T]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setResult(null);
    setSubmittedReservation(null);

    const controller = new AbortController();
    const timeoutMs = 20000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fullName = `${form.lastName} ${form.firstName}`.trim();
      const submittedServicePeriod = currentServicePeriod;
      const payload = {
        date: form.date,
        servicePeriod: submittedServicePeriod,
        course: form.course,
        phone: form.phone,
        name: fullName,
        lastName: form.lastName,
        firstName: form.firstName,
        note: form.note || undefined,
        partySize: Number(form.partySize),
        arrivalTime: form.arrivalTime,
      };
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResult(data.summary ?? "ご予約を受け付けました。");
        setSubmittedReservation({
          date: form.date,
          servicePeriod: submittedServicePeriod,
          partySize: Number(form.partySize),
          arrivalTime: form.arrivalTime,
          course: form.course,
          name: fullName,
          phone: form.phone,
        });
        const [nextDaily, nextMonthly] = await Promise.all([
          loadDailyAvailability(form.date, submittedServicePeriod, form.partySize).catch(
            () => checkingAvailability
          ),
          Promise.all(
            servicePeriods.map(async (period) => [
              period,
              await loadMonthlyAvailability(calendarMonth, period, form.partySize),
            ])
          ).catch(
            () =>
              servicePeriods.map((period) => [period, monthlyAvailabilityByPeriod[period]]) as Array<
                [ReservationServicePeriodKey, MonthlyAvailabilityMap]
              >
          ),
        ]);
        setAvailability(nextDaily);
        setResolvedAvailabilityKey(
          `${form.date}:${submittedServicePeriod}:${form.partySize}`
        );
        setMonthlyAvailabilityByPeriod({
          LUNCH: {},
          DINNER: {},
          ...Object.fromEntries(nextMonthly),
        } as MonthlyAvailabilityByPeriod);
        setResolvedMonthlyAvailabilityKey(
          `${getJstMonthKey(startOfJstMonth(calendarMonth))}:${form.partySize}`
        );
      } else {
        setError(data.error ?? data.reason ?? "予約に失敗しました。お電話ください。");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("通信がタイムアウトしました。時間をおいて再度お試しください。");
      } else {
        setError("通信エラーが発生しました。お電話ください。");
      }
    } finally {
      clearTimeout(timeoutId);
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const monthStart = startOfJstMonth(calendarMonth);
  const monthDays = getDaysInJstMonth(monthStart);
  const firstWeekday = getJstWeekday(monthStart);
  const calendarDayCircleSize = 28;
  const calendarDayCellWidth = 40;
  const calendarDayMarkerNormalFontSize = 13;
  const calendarDayCallMarkerFontSize = 13;
  const calendarDayMarkerNormalFontWeight = 900;
  const calendarDayCallMarkerFontWeight = 700;
  const calendarDayMarkerShadow =
    "0.35px 0 currentColor, -0.35px 0 currentColor, 0 0.35px currentColor, 0 -0.35px currentColor";
  const calendarDayMarkerTopMargin = 8;
  const calendarDayGapX = 3;
  const calendarDayGapY = 3;
  const calendarMonthNavButtonSize = 36;
  const calendarMonthNavArrowFontSize = 28;
  const calendarMonthNavArrowFontWeight = 600;
  const calendarMonthNavArrowOffsetY = "-0.1cm";
  const formFieldRadius = 6;
  const reserveButtonKnobWidth = 92;
  const reserveButtonKnobHeight = 52;
  const reserveButtonBorderWidth = 2;
  const rightPanelSectionGap = 50;
  const rightPanelPairGap = 12;
  const fieldLabelGap = 6;
  const calendarDayMarkerHeight = Math.max(
    calendarDayMarkerNormalFontSize,
    calendarDayCallMarkerFontSize
  ) + 8;
  const calendarDayCellHeight =
    calendarDayCircleSize + calendarDayMarkerTopMargin + calendarDayMarkerHeight;
  const calendarCells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: monthDays }, (_, idx) => {
      const { year, month } = getJstYearMonthParts(monthStart);
      const value = getJstDateKey(year, month, idx + 1);
      const dateObj = jstDateFromString(value);
      return { value, dateObj };
    }),
  ];
  const submitDisabled = submitting || availability.reason !== "OK";
  const submitButtonLabel = "予約";
  const submitAriaLabel = "予約する";
  const isCheckingAvailability = availability.reason === "CHECKING";
  const availabilityStatusMessage = isCheckingAvailability
    ? "空席状況を確認しています。少々お待ちください。"
    : availability.reason === "ERROR"
    ? "空席情報の取得に失敗しました。時間をおいて再度お試しください。"
    : availability.reason === "OK"
    ? "この条件でWeb予約できます。"
    : null;
  const submittedServiceLabel =
    submittedReservation?.servicePeriod === "LUNCH" ? "ランチ" : "ディナー";

  return (
    <form onSubmit={submit} className="rounded-xl bg-white p-6 space-y-4">
      {afterAvailabilityNote?.length ? (
        <div className="space-y-2 rounded-xl border border-[#cfa96d]/50 bg-[#fff7e6] px-4 py-3 text-sm leading-6 text-[#4a3121]">
          {afterAvailabilityNote.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}

      {availabilityStatusMessage ? (
        <div
          role="status"
          aria-live="polite"
          className={[
            "rounded-xl border px-4 py-3 text-sm leading-6",
            availability.reason === "ERROR"
              ? "border-[#b32626]/20 bg-[#fff1f1] text-[#b32626]"
              : availability.reason === "OK"
              ? "border-[#c7a357]/30 bg-[#fff8eb] text-[#4a3121]"
              : "border-[#cfa96d]/30 bg-[#fffdfa] text-[#6b5644]",
          ].join(" ")}
        >
          {availabilityStatusMessage}
        </div>
      ) : null}

      <section className="space-y-4 px-0 py-2 md:p-4">
        <div className="grid gap-6 md:grid-cols-[auto,minmax(0,1fr)] md:items-stretch">
          <div
            className="mx-auto mt-[-0.5cm] w-full max-w-[20.5rem] space-y-4 md:mx-0 md:mt-0 md:max-w-none"
          >
            <div className="flex items-center gap-3">
              <p className="text-sm font-semibold text-[#2f1b0f]">来店日</p>
            </div>

            <div className="mx-auto max-w-[19rem] rounded-md border-0 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setCalendarMonth((prev) => addJstMonths(prev, -1))}
                  className="rounded-md border-0 text-[#4a3121] leading-none hover:bg-[#f8f2e6]"
                  style={{
                    width: `${calendarMonthNavButtonSize}px`,
                    height: `${calendarMonthNavButtonSize}px`,
                    fontSize: `${calendarMonthNavArrowFontSize}px`,
                    fontWeight: calendarMonthNavArrowFontWeight,
                    transform: `translateY(${calendarMonthNavArrowOffsetY})`,
                  }}
                  aria-label="前月へ"
                >
                  ‹
                </button>
                <p className="text-base font-semibold text-[#2f1b0f]">
                  {formatJstMonth(monthStart)}
                </p>
                <button
                  type="button"
                  onClick={() => setCalendarMonth((prev) => addJstMonths(prev, 1))}
                  className="rounded-md border-0 text-[#4a3121] leading-none hover:bg-[#f8f2e6]"
                  style={{
                    width: `${calendarMonthNavButtonSize}px`,
                    height: `${calendarMonthNavButtonSize}px`,
                    fontSize: `${calendarMonthNavArrowFontSize}px`,
                    fontWeight: calendarMonthNavArrowFontWeight,
                    transform: `translateY(${calendarMonthNavArrowOffsetY})`,
                  }}
                  aria-label="次月へ"
                >
                  ›
                </button>
              </div>

              <div
                className="grid text-center text-xs text-[#7b6b5b]"
                style={{
                  gridTemplateColumns: `repeat(7, ${calendarDayCellWidth}px)`,
                  columnGap: `${calendarDayGapX}px`,
                  justifyContent: "center",
                }}
              >
                {dayLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>

              <div
                className="mt-1 grid"
                style={{
                  gridTemplateColumns: `repeat(7, ${calendarDayCellWidth}px)`,
                  columnGap: `${calendarDayGapX}px`,
                  rowGap: `${calendarDayGapY}px`,
                  justifyContent: "center",
                }}
              >
                {calendarCells.map((cell, idx) => {
                  if (!cell) {
                    return (
                      <div
                        key={`empty-${idx}`}
                        style={{
                          width: `${calendarDayCellWidth}px`,
                          height: `${calendarDayCellHeight}px`,
                        }}
                      />
                    );
                  }

                  const isSelected = cell.value === form.date;
                  const cellDay = cell.dateObj;
                  const isSameOrPast = cellDay.getTime() <= today.getTime();
                  const dailyStates = servicePeriods
                    .map((period) => getDateAvailability(cell.value, period))
                    .filter((daily): daily is AvailabilityResponse => daily != null);
                  const lunchDaily = getDateAvailability(cell.value, "LUNCH");
                  const dinnerDaily = getDateAvailability(cell.value, "DINNER");
                  const privateBlockMarkerText = getPrivateBlockMarkerText(
                    lunchDaily?.reason,
                    dinnerDaily?.reason
                  );
                  const hasBookablePeriod = dailyStates.some((daily) => daily.webBookable);
                  const hasPhoneOnlyPeriod = dailyStates.some((daily) => daily.reason === "PHONE_ONLY");
                  const isClosedDay =
                    dailyStates.length > 0 && dailyStates.every((daily) => daily.reason === "CLOSED");
                  const isDateDisabled =
                    isSameOrPast ||
                    (dailyStates.length > 0 &&
                      dailyStates.every((daily) => nonSelectableReasons.has(daily.reason)));

                  let markerText = "";
                  if (privateBlockMarkerText) {
                    markerText = privateBlockMarkerText;
                  } else if (hasBookablePeriod) {
                    markerText = "○";
                  } else if (hasPhoneOnlyPeriod) {
                    markerText = "△";
                  } else if (isClosedDay) {
                    markerText = "休";
                  }

                  const markerFontSize =
                    markerText === "夜のみ" || markerText === "昼のみ"
                      ? 10
                      : markerText === "終日貸切"
                      ? 9
                      : markerText === "△"
                      ? calendarDayCallMarkerFontSize
                      : calendarDayMarkerNormalFontSize;
                  const markerFontWeight =
                    markerText === "夜のみ" || markerText === "昼のみ" || markerText === "終日貸切"
                      ? 700
                      : markerText === "△"
                      ? calendarDayCallMarkerFontWeight
                      : calendarDayMarkerNormalFontWeight;
                  const markerColor =
                    markerText === "△" ||
                    markerText === "休" ||
                    markerText === "夜のみ" ||
                    markerText === "昼のみ" ||
                    markerText === "終日貸切"
                      ? "#b32626"
                      : "#7a5528";

                  return (
                    <div
                      key={cell.value}
                      className="flex flex-col items-center justify-start"
                      style={{
                        width: `${calendarDayCellWidth}px`,
                        height: `${calendarDayCellHeight}px`,
                      }}
                    >
                      <button
                        type="button"
                        disabled={isDateDisabled}
                        onClick={() => updateDate(cell.value)}
                        className={[
                          "rounded-full text-sm transition",
                          isSelected
                            ? "bg-[#d8b16a] text-[#2f1b0f] font-semibold"
                            : "text-[#4a3121] hover:bg-[#f8f2e6]",
                          isDateDisabled
                            ? "cursor-not-allowed opacity-35 hover:bg-transparent"
                            : "cursor-pointer",
                        ].join(" ")}
                        style={{
                          width: `${calendarDayCircleSize}px`,
                          height: `${calendarDayCircleSize}px`,
                        }}
                        aria-label={formatJstMonthDay(cell.dateObj)}
                      >
                        {getJstDayOfMonth(cell.dateObj)}
                      </button>
                      <span
                        className="block w-full select-none text-center"
                        style={{
                          minHeight: `${calendarDayMarkerHeight}px`,
                          marginTop: `${calendarDayMarkerTopMargin}px`,
                          color: markerColor,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: `${markerFontSize}px`,
                          fontWeight: markerFontWeight,
                          lineHeight: `${calendarDayMarkerHeight}px`,
                          textShadow:
                            markerText === "○" || markerText === "△"
                              ? calendarDayMarkerShadow
                              : undefined,
                        }}
                      >
                        {markerText}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            className="mx-auto flex h-full w-full max-w-[20.5rem] flex-col md:mx-0 md:max-w-none"
            style={{ rowGap: `${rightPanelSectionGap}px` }}
          >
            <div
              className="grid grid-cols-1 md:grid-cols-3"
              style={{
                columnGap: `${rightPanelPairGap}px`,
                rowGap: `${rightPanelPairGap}px`,
                gridTemplateColumns: undefined,
              }}
            >
              <div className="grid min-w-0" style={{ rowGap: `${fieldLabelGap}px` }}>
                <Label htmlFor="time-top">来店時間</Label>
                <select
                  id="time-top"
                  value={form.arrivalTime}
                  onChange={(e) => updateField("arrivalTime", e.target.value)}
                  className="h-10 w-full rounded-md border border-black bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-black/20"
                  style={{ borderRadius: `${formFieldRadius}px` }}
                  required
                >
                  {arrivalTimeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {selectedDateServiceStatus.privateBlockMarkerText === "夜のみ" ? (
                  <p className="text-xs text-[#8f2a2a]">
                    ランチは貸し切り営業のため、ディナーのみご予約いただけます。
                  </p>
                ) : null}
                {selectedDateServiceStatus.privateBlockMarkerText === "昼のみ" ? (
                  <p className="text-xs text-[#8f2a2a]">
                    ディナーは貸し切り営業のため、ランチのみご予約いただけます。
                  </p>
                ) : null}
              </div>

              <div className="grid min-w-0" style={{ rowGap: `${fieldLabelGap}px` }}>
                <Label htmlFor="party-size">人数</Label>
                <select
                  id="party-size"
                  value={form.partySize}
                  onChange={(e) => updateField("partySize", Number(e.target.value))}
                  className="h-10 w-full rounded-md border border-black bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-black/20"
                  style={{ borderRadius: `${formFieldRadius}px` }}
                  required
                >
                  {Array.from({ length: partyMax - partyMin + 1 }, (_, i) => partyMin + i).map((n) => (
                    <option key={n} value={n}>
                      {n}名
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid min-w-0" style={{ rowGap: `${fieldLabelGap}px` }}>
                <Label htmlFor="course">コース</Label>
                <select
                  id="course"
                  value={form.course}
                  onChange={(e) => updateField("course", e.target.value)}
                  className="h-10 w-full rounded-md border border-black bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-black/20"
                  style={{ borderRadius: `${formFieldRadius}px` }}
                  required
                >
                  {courseOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              className="grid sm:grid-cols-2"
              style={{ columnGap: `${rightPanelPairGap}px`, rowGap: `${rightPanelPairGap}px` }}
            >
              <div className="grid" style={{ rowGap: `${fieldLabelGap}px` }}>
                <Label htmlFor="last-name">氏名</Label>
                <div className="grid grid-cols-2" style={{ columnGap: `${rightPanelPairGap}px` }}>
                  <Input
                    id="last-name"
                    value={form.lastName}
                    onChange={(e) => updateField("lastName", e.target.value)}
                    className="border-black focus:ring-black/20 focus:border-black"
                    style={{ borderRadius: `${formFieldRadius}px` }}
                    placeholder="姓"
                    autoComplete="family-name"
                    aria-label="姓"
                    required
                  />
                  <Input
                    id="first-name"
                    value={form.firstName}
                    onChange={(e) => updateField("firstName", e.target.value)}
                    className="border-black focus:ring-black/20 focus:border-black"
                    style={{ borderRadius: `${formFieldRadius}px` }}
                    placeholder="名"
                    autoComplete="given-name"
                    aria-label="名"
                    required
                  />
                </div>
              </div>
              <div className="grid" style={{ rowGap: `${fieldLabelGap}px` }}>
                <Label htmlFor="phone">電話番号</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  type="tel"
                  autoComplete="tel"
                  className="border-black focus:ring-black/20 focus:border-black"
                  style={{ borderRadius: `${formFieldRadius}px` }}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">要望（任意）</Label>
              <Textarea
                id="note"
                value={form.note}
                onChange={(e) => updateField("note", e.target.value)}
                className="min-h-[7.5rem] w-full border-black focus:ring-black/20 focus:border-black md:min-h-[6.5rem]"
                placeholder="アレルギーや記念日のご希望など"
              />
            </div>

            <div className="hidden md:-mt-[1cm] md:block">
              <div className="space-y-3">
                <div className="flex w-full justify-end">
                  <button
                    type="submit"
                    className="relative inline-flex shrink-0 -translate-y-[0.2cm] items-center justify-center rounded-full border-0 bg-transparent p-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5a31]/35 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      width: `${reserveButtonKnobWidth}px`,
                      height: `${reserveButtonKnobHeight}px`,
                    }}
                    disabled={submitDisabled}
                    aria-label={submitting ? "送信中..." : submitAriaLabel}
                  >
                    <span
                      className="inline-flex items-center justify-center rounded-[26px] bg-gradient-to-b from-[#fffdfa] via-[#f7f2ea] to-[#efe6da]"
                      style={{
                        width: `${reserveButtonKnobWidth}px`,
                        height: `${reserveButtonKnobHeight}px`,
                        border: `${reserveButtonBorderWidth}px solid #8f6a39`,
                      }}
                    >
                      <span className="text-base font-semibold tracking-wide text-[#7a5528] md:text-lg">
                        {submitting ? "送信中" : submitButtonLabel}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {availability.reason === "PHONE_ONLY" ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md bg-[#fff7e6] px-4 py-3 text-sm text-[#8f2a2a]"
        >
          △ 電話のみ: この条件のご予約はWebで自動受付しません。店舗で確認しますので
          {availability.callPhone} までお電話ください。
        </p>
      ) : null}

      <div className="mx-auto w-full max-w-[20.5rem] space-y-3 pt-2 md:hidden">
        <div className="flex w-full justify-end">
          <button
            type="submit"
            className="relative inline-flex shrink-0 translate-y-[-0.5cm] items-center justify-center rounded-full border-0 bg-transparent p-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5a31]/35 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              width: `${reserveButtonKnobWidth}px`,
              height: `${reserveButtonKnobHeight}px`,
            }}
            disabled={submitDisabled}
            aria-label={submitting ? "送信中..." : submitAriaLabel}
          >
            <span
              className="inline-flex items-center justify-center rounded-[26px] bg-gradient-to-b from-[#fffdfa] via-[#f7f2ea] to-[#efe6da]"
              style={{
                width: `${reserveButtonKnobWidth}px`,
                height: `${reserveButtonKnobHeight}px`,
                border: `${reserveButtonBorderWidth}px solid #8f6a39`,
              }}
            >
              <span className="text-base font-semibold tracking-wide text-[#7a5528] md:text-lg">
                {submitting ? "送信中" : submitButtonLabel}
              </span>
            </span>
          </button>
        </div>
      </div>

      {result && submittedReservation ? (
        <div
          role="status"
          aria-live="polite"
          className="space-y-3 rounded-xl border border-[#c7a357]/30 bg-[#fff7e6] px-4 py-4 text-sm text-[#4a3121]"
        >
          <p className="font-semibold text-[#2f1b0f]">{result}</p>
          <div className="space-y-1">
            <p>ご来店日: {submittedReservation.date}</p>
            <p>時間帯: {submittedServiceLabel}</p>
            <p>来店時間: {submittedReservation.arrivalTime}</p>
            <p>人数: {submittedReservation.partySize}名</p>
            <p>コース: {submittedReservation.course}</p>
            <p>ご予約名: {submittedReservation.name}</p>
            <p>電話番号: {submittedReservation.phone}</p>
          </div>
          <div className="space-y-1 text-[#6b5644]">
            <p>キャンセルや変更はお電話にて承ります。</p>
            <p>
              連絡先:
              <a className="ml-1 underline" href={CONTACT_TEL_LINK}>
                {CONTACT_PHONE_DISPLAY}
              </a>
            </p>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" aria-live="assertive" className="text-red-700 text-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}
