import {
  getDefaultArrivalTimeForCourse,
  inferReservationServicePeriodFromArrivalTime,
  inferReservationServicePeriodFromCourse,
  isBeforeOpeningReservationDate,
  isArrivalTimeAllowed,
  normalizeReservationDateInput,
} from "@/lib/booking-rules";
import { addMonths } from "date-fns";
import {
  formatJst,
  jstDateFromString,
  todayJst,
} from "@/lib/dates";
import {
  getReservationCoursesForServicePeriod,
  RESERVATION_CONFIG,
  type ReservationServicePeriodKey,
} from "@/lib/reservation-config";

export function sanitizeDate(value: string | undefined, fallback: string): string {
  if (isExplicitReservationDateUsable(value)) {
    return value;
  }

  const normalized = normalizeReservationDateInput(value, fallback);
  try {
    const parsed = jstDateFromString(normalized);
    return Number.isNaN(parsed.getTime()) || formatJst(parsed) !== normalized ? fallback : normalized;
  } catch {
    return fallback;
  }
}

export function isExplicitReservationDateUsable(
  value: string | undefined,
  referenceDate: Date = todayJst()
): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  try {
    const parsed = jstDateFromString(value);
    if (!Number.isFinite(parsed.getTime()) || formatJst(parsed) !== value) {
      return false;
    }

    const referenceDateKey = formatJst(referenceDate);
    const maxDateKey = formatJst(addMonths(referenceDate, RESERVATION_CONFIG.bookingWindowMonths));
    return (
      !isBeforeOpeningReservationDate(parsed) &&
      value > referenceDateKey &&
      value <= maxDateKey
    );
  } catch {
    return false;
  }
}

export function shouldSearchFutureAvailability(partySize: number) {
  return partySize < 9;
}

export function findFirstWebBookableDate(
  availabilityByDate: Record<string, { webBookable: boolean } | undefined>,
  notBefore: string
) {
  return Object.keys(availabilityByDate)
    .filter((date) => date >= notBefore && availabilityByDate[date]?.webBookable === true)
    .sort()[0] ?? null;
}

export function sanitizePartySize(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 2;
  return Math.min(RESERVATION_CONFIG.maxPartySize, Math.max(1, parsed));
}

export function sanitizeServicePeriod(
  value: string | undefined,
  course?: string,
  arrivalTime?: string
): ReservationServicePeriodKey {
  const inferredFromArrivalTime = inferReservationServicePeriodFromArrivalTime(arrivalTime);
  if (inferredFromArrivalTime) {
    return inferredFromArrivalTime;
  }

  const inferredFromCourse = inferReservationServicePeriodFromCourse(course);
  if (inferredFromCourse) {
    return inferredFromCourse;
  }

  if (value === "LUNCH" || value === "DINNER") {
    return value;
  }

  return "LUNCH";
}

export function sanitizeCourse(
  value: string | undefined,
  servicePeriod: ReservationServicePeriodKey
) {
  const options = getReservationCoursesForServicePeriod(servicePeriod);
  if (options.some((option) => option.value === value)) {
    return value as string;
  }

  return options[0]?.value ?? "";
}

export function sanitizeArrivalTime(
  value: string | undefined,
  servicePeriod: ReservationServicePeriodKey
) {
  if (value && isArrivalTimeAllowed(value, undefined, servicePeriod)) {
    return value;
  }

  return getDefaultArrivalTimeForCourse(undefined, servicePeriod);
}
