import {
  getDefaultArrivalTimeForCourse,
  inferReservationServicePeriodFromArrivalTime,
  inferReservationServicePeriodFromCourse,
  isArrivalTimeAllowed,
  normalizeReservationDateInput,
} from "@/lib/booking-rules";
import { jstDateFromString } from "@/lib/dates";
import {
  getReservationCoursesForServicePeriod,
  RESERVATION_CONFIG,
  type ReservationServicePeriodKey,
} from "@/lib/reservation-config";

export function sanitizeDate(value: string | undefined, fallback: string) {
  const normalized = normalizeReservationDateInput(value, fallback);
  try {
    const parsed = jstDateFromString(normalized);
    return Number.isNaN(parsed.getTime()) ? fallback : normalized;
  } catch {
    return fallback;
  }
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
