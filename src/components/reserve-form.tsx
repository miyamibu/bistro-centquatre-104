"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDefaultArrivalTimeForCourse,
  getPrivateBlockMarkerAriaLabel,
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
  findFirstWebBookableDate,
  sanitizeArrivalTime,
  sanitizeCourse,
  sanitizeDate,
  sanitizePartySize,
  sanitizeServicePeriod,
  shouldSearchFutureAvailability,
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
  autoSelectFirstBookableDate?: boolean;
}

interface SubmittedReservationSummary {
  reservationId?: string;
  date: string;
  servicePeriod: ReservationServicePeriodKey;
  partySize: number;
  arrivalTime: string;
  course: string;
  name: string;
  phone: string;
  customerEmail: string;
}

interface LineNotificationResponse {
  enabled: boolean;
  linkUrl?: string;
}

const reservationFieldLabels: Record<string, string> = {
  date: "来店日",
  servicePeriod: "時間帯",
  time: "来店時間",
  partySize: "人数",
  arrivalTime: "来店時間",
  course: "コース",
  name: "氏名",
  lastName: "姓",
  firstName: "名",
  phone: "電話番号",
  customerEmail: "メールアドレス",
  note: "要望",
  root: "予約内容",
};

function parseReservationFieldErrors(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};

  return Object.entries(value).reduce<Record<string, string>>((errors, [field, message]) => {
    if (typeof message === "string" && message.trim()) {
      errors[field] = message;
    }
    return errors;
  }, {});
}

function getReservationFieldError(
  errors: Record<string, string>,
  ...keys: string[]
): string | undefined {
  return keys.map((key) => errors[key]).find((message) => Boolean(message));
}

function InlineFieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-xs leading-5 text-[#8f2a2a]">
      {message}
    </p>
  ) : null;
}

const reservationFieldTargetIds: Record<string, string> = {
  date: "reservation-calendar",
  servicePeriod: "time-top",
  time: "time-top",
  arrivalTime: "time-top",
  partySize: "party-size",
  course: "course",
  name: "last-name",
  lastName: "last-name",
  firstName: "first-name",
  phone: "phone",
  customerEmail: "customer-email",
  note: "note",
};

const servicePeriodLabels: Record<ReservationServicePeriodKey, string> = {
  LUNCH: "ランチ",
  DINNER: "ディナー",
};

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
const LIFF_OPERATION_TIMEOUT_MS = 10_000;
const AVAILABILITY_REQUEST_TIMEOUT_MS = 10_000;

function createReservationIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  throw new Error("Secure browser randomness is unavailable");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

async function fetchAvailabilityJson<T>(url: string, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, AVAILABILITY_REQUEST_TIMEOUT_MS);
  const abortFromExternalSignal = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = (await response.json().catch(() => null)) as T | null;
    return { response, data };
  } catch (error) {
    if (didTimeout) {
      throw new Error("AVAILABILITY_REQUEST_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

function withLiffTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out`));
    }, LIFF_OPERATION_TIMEOUT_MS);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

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
  autoSelectFirstBookableDate = false,
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
    customerEmail: "",
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
  // Keep the same key across timeout/network retries until the reservation is confirmed.
  const reservationIdempotencyKeyRef = useRef<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [autoAdjustmentMessage, setAutoAdjustmentMessage] = useState<string | null>(null);
  const [submittedReservation, setSubmittedReservation] =
    useState<SubmittedReservationSummary | null>(null);
  const [lineNotification, setLineNotification] =
    useState<LineNotificationResponse | null>(null);
  const [managementUrl, setManagementUrl] = useState<string | null>(null);
  // LIFF ID token は予約送信時にだけ使う。localStorage 等には保存しない。
  const lineIdTokenRef = useRef<string | null>(null);
  const [lineLinkStatus, setLineLinkStatus] = useState<
    "idle" | "connecting" | "linked" | "error"
  >("idle");
  const [lineLinkMessage, setLineLinkMessage] = useState<string | null>(null);
  // NEXT_PUBLIC_LIFF_BOOKING_ID is the canonical booking LIFF. Fall back to
  // deprecated NEXT_PUBLIC_LIFF_ID for backwards compatibility during migration.
  const liffIdFromEnv =
    typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_LIFF_BOOKING_ID ?? process.env.NEXT_PUBLIC_LIFF_ID)
      : undefined;
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
  const [monthlyAvailabilityError, setMonthlyAvailabilityError] = useState(false);
  const [monthlyAvailabilityLoading, setMonthlyAvailabilityLoading] = useState(false);
  const [availabilityRetryNonce, setAvailabilityRetryNonce] = useState(0);
  const initialFutureDateSearchStartedRef = useRef(false);
  const currentMonthlyRequestKey = `${getJstMonthKey(startOfJstMonth(calendarMonth))}:${form.partySize}`;
  const monthlyAvailabilityReady =
    !monthlyAvailabilityLoading &&
    !monthlyAvailabilityError &&
    resolvedMonthlyAvailabilityKey === currentMonthlyRequestKey;

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
    partySize: number,
    signal?: AbortSignal
  ) {
    const params = new URLSearchParams({
      date,
      servicePeriod,
      partySize: String(partySize),
    });
    const { response, data } = await fetchAvailabilityJson<AvailabilityState>(
      `/api/availability?${params.toString()}`,
      signal
    );

    if (!response.ok || !data) {
      throw new Error("DAILY_AVAILABILITY_FETCH_FAILED");
    }

    return data as AvailabilityState;
  }

  async function loadMonthlyAvailability(
    monthStartDate: Date,
    servicePeriod: ReservationServicePeriodKey,
    partySize: number,
    signal?: AbortSignal
  ) {
    const params = new URLSearchParams({
      month: getJstMonthKey(startOfJstMonth(monthStartDate)),
      servicePeriod,
      partySize: String(partySize),
    });
    const { response, data } = await fetchAvailabilityJson<{
      days?: MonthlyAvailabilityMap;
    }>(`/api/availability/monthly?${params.toString()}`, signal);

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
      return daily?.webBookable === true;
    });
  }

  function switchToServicePeriod(
    period: ReservationServicePeriodKey,
    previousPeriod: ReservationServicePeriodKey
  ) {
    const nextCourseOption = getReservationCoursesForServicePeriod(period)[0];
    const nextCourse = nextCourseOption?.value ?? "";
    const nextArrivalTime = getDefaultArrivalTimeForCourse(undefined, period);

    setForm((prev) => ({
      ...prev,
      course: nextCourse,
      arrivalTime: nextArrivalTime,
    }));
    setAutoAdjustmentMessage(
      `選択した日付では${servicePeriodLabels[previousPeriod]}が利用できないため、${servicePeriodLabels[period]}へ自動変更しました。来店時間は${nextArrivalTime}、コースは「${nextCourseOption?.label ?? nextCourse}」に切り替えています。時間とコースを確認してから予約してください。`
    );
  }

  function updateDate(date: string) {
    setAutoAdjustmentMessage(null);
    updateField("date", date);

    const currentDaily = getDateAvailability(date, currentServicePeriod);
    if (currentDaily?.webBookable === true) {
      return;
    }

    const fallbackPeriod = getSelectableFallbackPeriod(date, currentServicePeriod);
    if (fallbackPeriod) {
      switchToServicePeriod(fallbackPeriod, currentServicePeriod);
    }
  }

  function retryAvailability() {
    setResolvedAvailabilityKey(null);
    setResolvedMonthlyAvailabilityKey(null);
    setAvailability(checkingAvailability);
    setMonthlyAvailabilityError(false);
    setMonthlyAvailabilityLoading(true);
    setAutoAdjustmentMessage(null);
    setError(null);
    setAvailabilityRetryNonce((current) => current + 1);
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
    const controller = new AbortController();
    const requestKey = `${form.date}:${activeServicePeriod}:${form.partySize}`;
    if (resolvedAvailabilityKey === requestKey) {
      return;
    }

    setAvailability((prev) => ({ ...prev, reason: "CHECKING" }));

    loadDailyAvailability(form.date, activeServicePeriod, form.partySize, controller.signal)
      .then((data) => {
        if (!active) return;
        setAvailability(data);
        setResolvedAvailabilityKey(requestKey);
      })
      .catch((error) => {
        if (!active || isAbortError(error)) return;
        setAvailability({ ...checkingAvailability, reason: "ERROR" });
        setResolvedAvailabilityKey(requestKey);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    activeServicePeriod,
    availabilityRetryNonce,
    form.date,
    form.partySize,
    resolvedAvailabilityKey,
  ]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const requestKey = `${getJstMonthKey(startOfJstMonth(calendarMonth))}:${form.partySize}`;
    if (resolvedMonthlyAvailabilityKey === requestKey) {
      return;
    }

    setMonthlyAvailabilityError(false);
    setMonthlyAvailabilityLoading(true);
    Promise.all(
      servicePeriods.map(async (period) => [
        period,
        await loadMonthlyAvailability(calendarMonth, period, form.partySize, controller.signal),
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
        setMonthlyAvailabilityError(false);
        setMonthlyAvailabilityLoading(false);
      })
      .catch((error) => {
        if (!active || isAbortError(error)) return;
        setMonthlyAvailabilityByPeriod({
          LUNCH: {},
          DINNER: {},
        });
        setResolvedMonthlyAvailabilityKey(requestKey);
        setMonthlyAvailabilityError(true);
        setMonthlyAvailabilityLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    availabilityRetryNonce,
    calendarMonth,
    form.partySize,
    resolvedMonthlyAvailabilityKey,
  ]);

  useEffect(() => {
    if (!monthlyAvailabilityReady) {
      return;
    }

    const currentDaily = monthlyAvailabilityByPeriod[currentServicePeriod][form.date] ?? null;
    if (currentDaily == null || currentDaily.webBookable === true) {
      return;
    }

    const fallbackPeriod = servicePeriods.find((period) => {
      if (period === currentServicePeriod) {
        return false;
      }

      const daily = monthlyAvailabilityByPeriod[period][form.date] ?? null;
      return daily?.webBookable === true;
    });
    if (fallbackPeriod) {
      switchToServicePeriod(fallbackPeriod, currentServicePeriod);
    }
  }, [
    currentServicePeriod,
    form.date,
    monthlyAvailabilityByPeriod,
    monthlyAvailabilityReady,
  ]);

  useEffect(() => {
    if (
      !autoSelectFirstBookableDate ||
      initialFutureDateSearchStartedRef.current ||
      !monthlyAvailabilityReady ||
      !shouldSearchFutureAvailability(form.partySize)
    ) {
      return;
    }

    initialFutureDateSearchStartedRef.current = true;
    const currentPeriodDays = monthlyAvailabilityByPeriod[currentServicePeriod];
    if (currentPeriodDays[form.date]?.webBookable === true) {
      return;
    }

    let active = true;
    const controller = new AbortController();

    async function selectFirstFutureDate() {
      let nextDate = findFirstWebBookableDate(currentPeriodDays, form.date);

      for (
        let monthOffset = 1;
        nextDate == null && monthOffset <= RESERVATION_CONFIG.bookingWindowMonths;
        monthOffset += 1
      ) {
        const candidateMonth = addJstMonths(calendarMonth, monthOffset);
        const candidateDays = await loadMonthlyAvailability(
          candidateMonth,
          currentServicePeriod,
          form.partySize,
          controller.signal
        );
        nextDate = findFirstWebBookableDate(candidateDays, form.date);
      }

      if (!active || !nextDate || nextDate === form.date) return;
      setForm((previous) => ({ ...previous, date: nextDate as string }));
      setAutoAdjustmentMessage(`最初に予約可能な日付（${nextDate}）を表示しています。`);
    }

    selectFirstFutureDate().catch((error) => {
      if (!isAbortError(error)) {
        // Keep the original date and the already loaded calendar available.
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    autoSelectFirstBookableDate,
    calendarMonth,
    currentServicePeriod,
    form.date,
    form.partySize,
    monthlyAvailabilityByPeriod,
    monthlyAvailabilityReady,
  ]);

  function updateField<T extends keyof typeof form>(key: T, value: (typeof form)[T]) {
    if (key === "date" || key === "partySize" || key === "course" || key === "arrivalTime") {
      setAutoAdjustmentMessage(null);
    }
    setError(null);
    setForm((prev) => ({ ...prev, [key]: value }));
    const fieldErrorKeys =
      key === "lastName" || key === "firstName"
        ? ["name", "lastName", "firstName"]
        : key === "arrivalTime"
          ? ["time", "arrivalTime", "servicePeriod"]
          : [key];
    setFieldErrors((prev) => {
      const next = { ...prev };
      fieldErrorKeys.forEach((field) => delete next[field]);
      return next;
    });
  }

  async function handleLineLink() {
    if (!liffIdFromEnv) return;
    setLineLinkStatus("connecting");
    setLineLinkMessage(null);
    try {
      const liffModule = await withLiffTimeout(import("@line/liff"), "LIFF SDK loading");
      const liff = liffModule.default;
      await withLiffTimeout(liff.init({ liffId: liffIdFromEnv }), "LIFF initialization");
      if (!liff.isLoggedIn()) {
        // login() triggers a navigation; nothing after will run on this load.
        liff.login();
        return;
      }
      if (liff.isInClient() && typeof liff.requestFriendship === "function") {
        try {
          await withLiffTimeout(liff.requestFriendship(), "LINE friendship request");
        } catch {
          // some clients/contexts disallow this; continue and rely on getFriendship check below.
        }
      }
      const friendship = await withLiffTimeout(liff.getFriendship(), "LINE friendship check");
      if (!friendship?.friendFlag) {
        setLineLinkStatus("error");
        setLineLinkMessage(
          "LINE公式アカウントの友だち追加が必要です。通常予約はそのまま続行できます。"
        );
        lineIdTokenRef.current = null;
        return;
      }
      const idToken = liff.getIDToken();
      if (!idToken) {
        setLineLinkStatus("error");
        setLineLinkMessage(
          "LINE連携に失敗しました。通常予約はそのまま続行できます。"
        );
        lineIdTokenRef.current = null;
        return;
      }
      lineIdTokenRef.current = idToken;
      setLineLinkStatus("linked");
      setLineLinkMessage("LINE前日通知を受け取ります。");
    } catch {
      setLineLinkStatus("error");
      setLineLinkMessage(
        "LINE連携に失敗しました。通常予約はそのまま続行できます。"
      );
      lineIdTokenRef.current = null;
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current || submittedReservation) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setResult(null);
    setSubmittedReservation(null);
    setManagementUrl(null);

    const controller = new AbortController();
    const timeoutMs = 20000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const fullName = `${form.lastName} ${form.firstName}`.trim();
      const submittedServicePeriod = currentServicePeriod;
      const linkedLineIdToken =
        lineLinkStatus === "linked" ? lineIdTokenRef.current : null;
      const payload: Record<string, unknown> = {
        date: form.date,
        servicePeriod: submittedServicePeriod,
        course: form.course,
        phone: form.phone,
        customerEmail: form.customerEmail,
        name: fullName,
        lastName: form.lastName,
        firstName: form.firstName,
        note: form.note || undefined,
        partySize: Number(form.partySize),
        arrivalTime: form.arrivalTime,
      };
      if (linkedLineIdToken) {
        payload.lineIdToken = linkedLineIdToken;
      }
      const idempotencyKey =
        reservationIdempotencyKeyRef.current ?? createReservationIdempotencyKey();
      reservationIdempotencyKeyRef.current = idempotencyKey;
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const confirmedReservationId =
          typeof data.reservationId === "string" && data.reservationId.trim()
            ? data.reservationId
            : null;
        if (confirmedReservationId) {
          reservationIdempotencyKeyRef.current = null;
        }
        setResult(data.summary ?? "ご予約を受け付けました。");
        if (typeof data.managementUrl === "string" && data.managementUrl.trim()) {
          setManagementUrl(data.managementUrl);
        }
        if (data.lineNotification) {
          setLineNotification(data.lineNotification as LineNotificationResponse);
        }
        setSubmittedReservation({
          reservationId: confirmedReservationId ?? undefined,
          date: form.date,
          servicePeriod: submittedServicePeriod,
          partySize: Number(form.partySize),
          arrivalTime: form.arrivalTime,
          course: form.course,
          name: fullName,
          phone: form.phone,
          customerEmail: form.customerEmail,
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
        if (res.status === 400 || data.code === "IDEMPOTENCY_CONFLICT") {
          reservationIdempotencyKeyRef.current = null;
        }
        const parsedFieldErrors = parseReservationFieldErrors(data.fields);
        const apiErrorMessage =
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : typeof data.reason === "string" && data.reason.trim()
              ? data.reason
              : "入力内容を確認してください。";
        if (
          data.code === "INVALID_ARRIVAL_TIME" &&
          !getReservationFieldError(parsedFieldErrors, "time", "arrivalTime", "servicePeriod")
        ) {
          parsedFieldErrors.time = apiErrorMessage;
        }
        if (data.code === "COURSE_TIME_MISMATCH" && !parsedFieldErrors.course) {
          parsedFieldErrors.course = apiErrorMessage;
        }
        setFieldErrors(parsedFieldErrors);
        setError(
          Object.keys(parsedFieldErrors).length > 0
            ? null
            : data.error ?? data.reason ?? "予約に失敗しました。お電話ください。"
        );
        const firstFieldTarget = Object.keys(parsedFieldErrors)
          .map((field) => reservationFieldTargetIds[field])
          .find((targetId) => Boolean(targetId));
        if (firstFieldTarget) {
          window.requestAnimationFrame(() => {
            const target = document.getElementById(firstFieldTarget);
            if (!(target instanceof HTMLElement)) return;
            target.focus();
            target.scrollIntoView({ block: "center", behavior: "smooth" });
          });
        }
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
  const calendarDayCircleSize = 44;
  const calendarDayMarkerNormalFontSize = 13;
  const calendarDayCallMarkerFontSize = 13;
  const calendarDayMarkerNormalFontWeight = 900;
  const calendarDayCallMarkerFontWeight = 700;
  const calendarDayMarkerShadow =
    "0.35px 0 currentColor, -0.35px 0 currentColor, 0 0.35px currentColor, 0 -0.35px currentColor";
  const calendarDayMarkerTopMargin = 8;
  const calendarDayGapX = 0;
  const calendarDayGapY = 3;
  const calendarMonthNavButtonSize = 44;
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
  const reservationCompleted = Boolean(submittedReservation);
  const submitDisabled = submitting || reservationCompleted || availability.reason !== "OK";
  const submitButtonLabel = reservationCompleted ? "受付済み" : "予約";
  const submitAriaLabel = reservationCompleted ? "予約受付済み" : "予約する";
  const isCheckingAvailability = availability.reason === "CHECKING";
  const availabilityStatusMessage = isCheckingAvailability
    ? "空席状況を確認しています。少々お待ちください。"
    : availability.reason === "ERROR"
    ? "空席情報の取得に失敗しました。時間をおいて再度お試しください。"
    : availability.reason === "OK"
    ? "この条件でWeb予約できます。"
    : availability.reason === "CLOSED"
    ? "休業日のため予約できません。別の日を選択するか、お電話でご相談ください。"
    : availability.reason === "PRIVATE_BLOCK"
    ? "貸切営業のため、この条件ではWeb予約できません。別の時間帯を選択するか、お電話でご相談ください。"
    : availability.reason === "PHONE_ONLY"
    ? "この時間帯は電話のみで承ります。店舗へお電話ください。"
    : null;
  const submittedServiceLabel =
    submittedReservation?.servicePeriod === "LUNCH" ? "ランチ" : "ディナー";
  const dateFieldError = getReservationFieldError(fieldErrors, "date");
  const timeFieldError = getReservationFieldError(
    fieldErrors,
    "time",
    "arrivalTime",
    "servicePeriod"
  );
  const partySizeFieldError = getReservationFieldError(fieldErrors, "partySize");
  const courseFieldError = getReservationFieldError(fieldErrors, "course");
  const nameFieldError = getReservationFieldError(fieldErrors, "name", "lastName", "firstName");
  const phoneFieldError = getReservationFieldError(fieldErrors, "phone");
  const customerEmailFieldError = getReservationFieldError(fieldErrors, "customerEmail");
  const noteFieldError = getReservationFieldError(fieldErrors, "note");
  const calendarErrorAttributes = dateFieldError ? { "aria-invalid": true } : {};

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
          role={availability.reason === "ERROR" ? "alert" : "status"}
          aria-live={availability.reason === "ERROR" ? "assertive" : "polite"}
          className={[
            "rounded-xl border px-4 py-3 text-sm leading-6",
            availability.reason === "ERROR"
              ? "border-[#b32626]/20 bg-[#fff1f1] text-[#b32626]"
              : availability.reason === "OK"
              ? "border-[#c7a357]/30 bg-[#fff8eb] text-[#4a3121]"
              : "border-[#cfa96d]/30 bg-[#fffdfa] text-[#6b5644]",
          ].join(" ")}
        >
          <p>{availabilityStatusMessage}</p>
          {availability.reason === "ERROR" || availability.reason === "CHECKING" ? (
            <button
              type="button"
              onClick={retryAvailability}
              disabled={isCheckingAvailability}
              className="mt-2 inline-flex min-h-10 items-center justify-center rounded-full border border-current px-4 py-2 text-sm font-semibold transition hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8f2a2a]/30"
            >
              {isCheckingAvailability ? "再取得中..." : "空席情報を再取得"}
            </button>
          ) : null}
        </div>
      ) : null}

      {autoAdjustmentMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-[#c7a357]/40 bg-[#fff8eb] px-4 py-3 text-sm leading-6 text-[#6b4b2b]"
        >
          {autoAdjustmentMessage}
        </div>
      ) : null}

      {Object.keys(fieldErrors).length > 0 ? (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-[#b32626]/20 bg-[#fff1f1] px-4 py-3 text-sm leading-6 text-[#8f2a2a]"
        >
          <p className="font-semibold">入力内容を確認してください。</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {Object.entries(fieldErrors).map(([field, message]) => (
              <li key={field}>
                <span className="font-semibold">{reservationFieldLabels[field] ?? field}</span>：{message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="space-y-4 px-0 py-2 md:p-4">
        <div className="grid gap-6 md:grid-cols-[auto,minmax(0,1fr)] md:items-stretch">
          <div
            className="mx-auto mt-[-0.5cm] w-full min-w-0 max-w-[21rem] space-y-4 md:mx-0 md:mt-0 md:max-w-none"
          >
            <div className="flex items-center gap-3">
              <p id="reservation-calendar-label" className="text-sm font-semibold text-[#2f1b0f]">
                来店日 <span className="text-[#b32626]">（必須）</span>
              </p>
            </div>

            {(monthlyAvailabilityError || monthlyAvailabilityLoading) && availability.reason !== "ERROR" ? (
              <div
                role={monthlyAvailabilityLoading ? "status" : "alert"}
                aria-live={monthlyAvailabilityLoading ? "polite" : "assertive"}
                aria-busy={monthlyAvailabilityLoading}
                className="rounded-xl border border-[#b32626]/20 bg-[#fff1f1] px-4 py-3 text-sm leading-6 text-[#8f2a2a]"
              >
                <p>
                  {monthlyAvailabilityLoading
                    ? "カレンダーの空席情報を確認しています。"
                    : "カレンダーの空席情報を取得できませんでした。"}
                </p>
                <button
                  type="button"
                  onClick={retryAvailability}
                  disabled={monthlyAvailabilityLoading}
                  className="mt-2 inline-flex min-h-10 items-center justify-center rounded-full border border-current px-4 py-2 text-sm font-semibold transition hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8f2a2a]/30"
                >
                  {monthlyAvailabilityLoading ? "再取得中..." : "カレンダーを再取得"}
                </button>
              </div>
            ) : null}

            <div
              role="group"
              aria-labelledby="reservation-calendar-label"
              id="reservation-calendar"
              tabIndex={-1}
              aria-busy={!monthlyAvailabilityReady}
              {...calendarErrorAttributes}
              aria-describedby={dateFieldError ? "reservation-error-date" : undefined}
              className="relative left-1/2 mx-0 w-screen max-w-none -translate-x-1/2 rounded-md border-0 bg-white p-1.5 md:static md:left-auto md:mx-auto md:w-full md:max-w-[21rem] md:translate-x-0 md:p-3"
            >
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
                className="grid w-full text-center text-xs text-[#7b6b5b]"
                style={{
                  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                  columnGap: `${calendarDayGapX}px`,
                }}
              >
                {dayLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>

              <div
                aria-label="カレンダー凡例"
                className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] leading-5 text-[#6b5644]"
              >
                <span><strong className="text-[#7a5528]">○</strong> Web予約可</span>
                <span><strong className="text-[#b32626]">△</strong> 電話確認</span>
                <span><strong className="text-[#b32626]">休</strong> 休業</span>
                <span><strong className="text-[#b32626]">貸切</strong> 貸切・時間帯制限</span>
                {!monthlyAvailabilityReady ? (
                  <span><strong className="text-[#7b6b5b]">—</strong> 未確認</span>
                ) : null}
              </div>

              <div className="mt-1 overflow-x-auto">
              <div
                className="grid w-full"
                style={{
                  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                  columnGap: `${calendarDayGapX}px`,
                  rowGap: `${calendarDayGapY}px`,
                  minWidth: `${calendarMonthNavButtonSize * 7 + calendarDayGapX * 6}px`,
                }}
              >
                {calendarCells.map((cell, idx) => {
                  if (!cell) {
                    return (
                      <div
                        key={`empty-${idx}`}
                        style={{
                          width: "100%",
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
                  const isUnconfirmedDate = !isSelected && !monthlyAvailabilityReady;
                  const isDateDisabled =
                    isSameOrPast ||
                    isUnconfirmedDate ||
                    (monthlyAvailabilityReady &&
                      dailyStates.length > 0 &&
                      dailyStates.every((daily) => nonSelectableReasons.has(daily.reason)));

                  let markerText = "";
                  if (isUnconfirmedDate) {
                    markerText = "—";
                  } else if (privateBlockMarkerText) {
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
                  const markerAriaLabel =
                    markerText === "—"
                      ? "空席未確認"
                      : markerText === "○"
                      ? "Web予約可"
                      : markerText === "△"
                      ? "電話確認"
                      : markerText === "休"
                      ? "休業"
                      : markerText === "夜のみ" || markerText === "昼のみ"
                      ? getPrivateBlockMarkerAriaLabel(markerText)
                      : markerText === "終日貸切"
                      ? "終日貸切"
                      : "";

                  return (
                    <div
                      key={cell.value}
                      className="flex flex-col items-center justify-start"
                      style={{
                        width: "100%",
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
                        aria-label={`${formatJstMonthDay(cell.dateObj)}${isDateDisabled ? " 予約不可" : ""}${markerAriaLabel ? ` ${markerAriaLabel}` : ""}`}
                        aria-pressed={isSelected}
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
                        <span aria-hidden="true">{markerText}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              </div>
              <InlineFieldError id="reservation-error-date" message={dateFieldError} />
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
                <Label htmlFor="time-top">来店時間 <span className="text-[#b32626]">（必須）</span></Label>
                <select
                  id="time-top"
                  value={form.arrivalTime}
                  onChange={(e) => updateField("arrivalTime", e.target.value)}
                  className="min-h-11 w-full rounded-md border border-black bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-black/20"
                  style={{ borderRadius: `${formFieldRadius}px` }}
                  aria-invalid={timeFieldError ? true : undefined}
                  aria-describedby={timeFieldError ? "reservation-error-time" : undefined}
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
                <InlineFieldError id="reservation-error-time" message={timeFieldError} />
              </div>

              <div className="grid min-w-0" style={{ rowGap: `${fieldLabelGap}px` }}>
                <Label htmlFor="party-size">人数 <span className="text-[#b32626]">（必須）</span></Label>
                <select
                  id="party-size"
                  value={form.partySize}
                  onChange={(e) => updateField("partySize", Number(e.target.value))}
                  className="min-h-11 w-full rounded-md border border-black bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-black/20"
                  style={{ borderRadius: `${formFieldRadius}px` }}
                  aria-invalid={partySizeFieldError ? true : undefined}
                  aria-describedby={partySizeFieldError ? "reservation-error-party-size" : undefined}
                  required
                >
                  {Array.from({ length: partyMax - partyMin + 1 }, (_, i) => partyMin + i).map((n) => (
                    <option key={n} value={n}>
                      {n}名
                    </option>
                  ))}
                </select>
                <InlineFieldError id="reservation-error-party-size" message={partySizeFieldError} />
              </div>

              <div className="grid min-w-0" style={{ rowGap: `${fieldLabelGap}px` }}>
                <Label htmlFor="course">コース <span className="text-[#b32626]">（必須）</span></Label>
                <select
                  id="course"
                  value={form.course}
                  onChange={(e) => updateField("course", e.target.value)}
                  className="min-h-11 w-full rounded-md border border-black bg-white px-3 text-sm text-[#2f1b0f] focus:outline-none focus:ring-2 focus:ring-black/20"
                  style={{ borderRadius: `${formFieldRadius}px` }}
                  aria-invalid={courseFieldError ? true : undefined}
                  aria-describedby={courseFieldError ? "reservation-error-course" : undefined}
                  required
                >
                  {courseOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <InlineFieldError id="reservation-error-course" message={courseFieldError} />
              </div>
            </div>

            <div
              className="grid sm:grid-cols-2"
              style={{ columnGap: `${rightPanelPairGap}px`, rowGap: `${rightPanelPairGap}px` }}
            >
              <div className="grid" style={{ rowGap: `${fieldLabelGap}px` }}>
                <Label htmlFor="last-name">氏名 <span className="text-[#b32626]">（必須）</span></Label>
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
                    aria-invalid={nameFieldError ? true : undefined}
                    aria-describedby={nameFieldError ? "reservation-error-name" : undefined}
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
                    aria-invalid={nameFieldError ? true : undefined}
                    aria-describedby={nameFieldError ? "reservation-error-name" : undefined}
                    required
                  />
                </div>
                <InlineFieldError id="reservation-error-name" message={nameFieldError} />
              </div>
              <div className="grid" style={{ rowGap: `${fieldLabelGap}px` }}>
                <Label htmlFor="phone">電話番号 <span className="text-[#b32626]">（必須）</span></Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  type="tel"
                  autoComplete="tel"
                  className="border-black focus:ring-black/20 focus:border-black"
                  style={{ borderRadius: `${formFieldRadius}px` }}
                  aria-invalid={phoneFieldError ? true : undefined}
                  aria-describedby={phoneFieldError ? "reservation-error-phone" : undefined}
                  required
                />
                <InlineFieldError id="reservation-error-phone" message={phoneFieldError} />
              </div>
            </div>

            <div className="grid" style={{ rowGap: `${fieldLabelGap}px` }}>
              <Label htmlFor="customer-email">
                メールアドレス（予約管理リンク送信用）
                {lineLinkStatus !== "linked" ? <span className="text-[#b32626]">（必須）</span> : null}
              </Label>
              <Input
                id="customer-email"
                value={form.customerEmail}
                onChange={(e) => updateField("customerEmail", e.target.value)}
                type="email"
                autoComplete="email"
                className="border-black focus:ring-black/20 focus:border-black"
                style={{ borderRadius: `${formFieldRadius}px` }}
                aria-invalid={customerEmailFieldError ? true : undefined}
                aria-describedby={customerEmailFieldError ? "reservation-error-customer-email" : undefined}
                required={lineLinkStatus !== "linked"}
              />
              <p className="text-xs leading-5 text-[#6b5644]">
                {lineLinkStatus === "linked"
                  ? "本人確認済みLINEへ管理情報を送るため、メールアドレスは任意です。"
                  : "予約内容の確認・キャンセルリンクを送ります。入力間違いにご注意ください。"}
              </p>
              <InlineFieldError id="reservation-error-customer-email" message={customerEmailFieldError} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="note">要望（任意）</Label>
              <Textarea
                id="note"
                value={form.note}
                onChange={(e) => updateField("note", e.target.value)}
                className="min-h-[7.5rem] w-full border-black focus:ring-black/20 focus:border-black md:min-h-[6.5rem]"
                placeholder="アレルギーや記念日のご希望など"
                aria-invalid={noteFieldError ? true : undefined}
                aria-describedby={noteFieldError ? "reservation-error-note" : undefined}
              />
              <InlineFieldError id="reservation-error-note" message={noteFieldError} />
            </div>

            <div className="hidden md:-mt-[1cm] md:block">
              <div className="space-y-3">
                <div className="flex w-full items-center justify-end gap-3">
                  {liffIdFromEnv ? (
                    <p className="-translate-y-[0.2cm] text-right text-xs leading-snug text-[#2f6b3b] md:text-sm">
                      連携すると
                      <br />
                      前日にLINE通知
                    </p>
                  ) : null}
                  {liffIdFromEnv ? (
                    <div className="flex flex-col items-end gap-1 -translate-y-[0.2cm]">
                      <button
                        type="button"
                        onClick={handleLineLink}
                        disabled={
                          lineLinkStatus === "connecting" ||
                          lineLinkStatus === "linked"
                        }
                        className="relative inline-flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1ec55a]/40 disabled:cursor-not-allowed disabled:opacity-60"
                        style={{
                          width: `${reserveButtonKnobWidth}px`,
                          height: `${reserveButtonKnobHeight}px`,
                        }}
                        aria-label="LINEで前日通知を受け取る"
                      >
                        <span
                          className="inline-flex items-center justify-center rounded-[26px] bg-gradient-to-b from-[#fffdfa] via-[#f4fbf5] to-[#e8f7ec]"
                          style={{
                            width: `${reserveButtonKnobWidth}px`,
                            height: `${reserveButtonKnobHeight}px`,
                            border: `${reserveButtonBorderWidth}px solid #1ec55a`,
                          }}
                        >
                          <span className="text-base font-semibold tracking-wide text-[#1a8a3f] md:text-lg">
                            {lineLinkStatus === "linked"
                              ? "連携済"
                              : lineLinkStatus === "connecting"
                                ? "連携中"
                                : "LINE"}
                          </span>
                        </span>
                      </button>
                      {lineLinkMessage ? (
                        <p
                          role="status"
                          aria-live="polite"
                          className={
                            lineLinkStatus === "linked"
                              ? "text-xs text-[#2f6b3b]"
                              : "text-xs text-[#8f2a2a]"
                          }
                        >
                          {lineLinkMessage}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
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
        <div className="flex w-full items-center justify-end gap-2">
          {liffIdFromEnv ? (
            <p className="translate-y-[-0.5cm] text-right text-[10px] leading-snug text-[#2f6b3b]">
              連携すると
              <br />
              前日にLINE通知
            </p>
          ) : null}
          {liffIdFromEnv ? (
            <div className="flex flex-col items-end gap-1 translate-y-[-0.5cm]">
              <button
                type="button"
                onClick={handleLineLink}
                disabled={
                  lineLinkStatus === "connecting" || lineLinkStatus === "linked"
                }
                className="relative inline-flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1ec55a]/40 disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  width: `${reserveButtonKnobWidth}px`,
                  height: `${reserveButtonKnobHeight}px`,
                }}
                aria-label="LINEで前日通知を受け取る"
              >
                <span
                  className="inline-flex items-center justify-center rounded-[26px] bg-gradient-to-b from-[#fffdfa] via-[#f4fbf5] to-[#e8f7ec]"
                  style={{
                    width: `${reserveButtonKnobWidth}px`,
                    height: `${reserveButtonKnobHeight}px`,
                    border: `${reserveButtonBorderWidth}px solid #1ec55a`,
                  }}
                >
                  <span className="text-base font-semibold tracking-wide text-[#1a8a3f] md:text-lg">
                    {lineLinkStatus === "linked"
                      ? "連携済"
                      : lineLinkStatus === "connecting"
                        ? "連携中"
                        : "LINE"}
                  </span>
                </span>
              </button>
              {lineLinkMessage ? (
                <p
                  role="status"
                  aria-live="polite"
                  className={
                    lineLinkStatus === "linked"
                      ? "text-[10px] text-[#2f6b3b]"
                      : "text-[10px] text-[#8f2a2a]"
                  }
                >
                  {lineLinkMessage}
                </p>
              ) : null}
            </div>
          ) : null}
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
          {submittedReservation.reservationId ? (
            <div className="rounded-md border border-[#c7a357]/30 bg-white/70 px-3 py-2">
              <p className="font-semibold text-[#2f1b0f]">
                予約番号: <span className="break-all">{submittedReservation.reservationId}</span>
              </p>
              <p className="mt-1 text-xs text-[#6b5644]">
                変更や確認の際は、この予約番号を店舗へお伝えください。
              </p>
            </div>
          ) : null}
          <div className="space-y-1">
            <p>ご来店日: {submittedReservation.date}</p>
            <p>時間帯: {submittedServiceLabel}</p>
            <p>来店時間: {submittedReservation.arrivalTime}</p>
            <p>人数: {submittedReservation.partySize}名</p>
            <p>コース: {submittedReservation.course}</p>
            <p>ご予約名: {submittedReservation.name}</p>
            <p>電話番号: {submittedReservation.phone}</p>
            <p>
              管理リンク送信先: {submittedReservation.customerEmail || "本人確認済みLINE"}
            </p>
          </div>
          {managementUrl ? (
            <div className="space-y-2 rounded-md border border-[#cfa96d]/45 bg-white/70 px-3 py-3">
              <p className="font-semibold text-[#2f1b0f]">
                予約内容の確認・キャンセル
              </p>
              <p className="text-sm leading-6 text-[#6b5644]">
                下の管理リンクは、予約内容の確認とキャンセルに使えます。リンクは他の方と共有しないでください。
              </p>
              <a
                href={managementUrl}
                referrerPolicy="no-referrer"
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#7a5528] px-4 py-2 text-sm font-semibold text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a5528]/40"
              >
                予約内容を確認・キャンセルする
              </a>
            </div>
          ) : null}
          {lineNotification?.enabled ? (
            <p className="rounded-md bg-[#e8f7ec] px-3 py-2 text-sm text-[#1a8a3f]">
              LINE前日通知を設定済みです。
            </p>
          ) : lineNotification?.linkUrl ? (
            <div className="space-y-1 rounded-md border border-[#1ec55a]/30 bg-[#f4fbf5] px-3 py-2">
              <p className="text-sm text-[#2f6b3b]">
                予約後でもLINE通知を設定できます。
              </p>
              <a
                href={lineNotification.linkUrl}
                className="inline-block rounded-full bg-[#1ec55a] px-4 py-1.5 text-sm font-semibold text-white"
              >
                LINEで前日通知を受け取る
              </a>
            </div>
          ) : null}
          <div className="space-y-1 text-[#6b5644]">
            <p>管理リンクが見つからない場合や変更をご希望の場合は、お電話にて承ります。</p>
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
