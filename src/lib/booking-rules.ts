import { addDays, startOfDay, subDays } from "date-fns";
import {
  formatJst,
  getJstWeekday,
  isAfterOrSameOpeningDate,
  isBeyondRange,
  isSameOrBeforeToday,
  jstDateFromString,
  jstDateTimeFromString,
  nowJst,
  todayJst,
} from "@/lib/dates";
import {
  RESERVATION_CONFIG,
  type ReservationServicePeriodKey,
} from "@/lib/reservation-config";

const closedWeekdaySet = new Set<number>(RESERVATION_CONFIG.closedWeekdays);
const closedDateSet = new Set<string>(RESERVATION_CONFIG.closedDates);
const closedServicePeriodSet = new Set<string>(
  RESERVATION_CONFIG.closedServicePeriods.map(
    ({ date, servicePeriod }) => `${date}:${servicePeriod}`
  )
);
const specialOpenDateSet = new Set<string>(RESERVATION_CONFIG.specialOpenDates);
const servicePeriodEntries = Object.entries(
  RESERVATION_CONFIG.servicePeriods
) as [ReservationServicePeriodKey, (typeof RESERVATION_CONFIG.servicePeriods)[ReservationServicePeriodKey]][];

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function isClosedReservationWeekday(date: Date): boolean {
  return closedWeekdaySet.has(getJstWeekday(date));
}

export function isClosedReservationDateBySchedule(date: Date): boolean {
  const dateKey = formatJst(date);

  if (closedDateSet.has(dateKey)) {
    return true;
  }

  if (specialOpenDateSet.has(dateKey)) {
    return false;
  }

  return isClosedReservationWeekday(date);
}

export function isClosedReservationDate(
  date: Date,
  options?: {
    businessDayClosed?: boolean;
    servicePeriod?: ReservationServicePeriodKey;
  }
): boolean {
  if (options?.businessDayClosed) {
    return true;
  }

  if (
    options?.servicePeriod &&
    closedServicePeriodSet.has(`${formatJst(date)}:${options.servicePeriod}`)
  ) {
    return true;
  }

  return isClosedReservationDateBySchedule(date);
}

export function isBeforeOpeningReservationDate(date: Date): boolean {
  return !isAfterOrSameOpeningDate(date);
}

export function getReservationCutoffDate(date: Date): Date {
  const previousDay = formatJst(subDays(date, RESERVATION_CONFIG.bookingCutoff.daysBefore));
  return jstDateTimeFromString(previousDay, RESERVATION_CONFIG.bookingCutoff.time);
}

export function isReservationCutoffPassed(date: Date, now: Date = nowJst()): boolean {
  return now.getTime() > getReservationCutoffDate(date).getTime();
}

export function canAcceptWebReservation(
  date: Date,
  options?: { businessDayClosed?: boolean; now?: Date }
): boolean {
  return (
    !isBeforeOpeningReservationDate(date) &&
    !isSameOrBeforeToday(date) &&
    !isBeyondRange(date) &&
    !isClosedReservationDate(date, options) &&
    !isReservationCutoffPassed(date, options?.now)
  );
}

export function getNextBookableReservationDate(
  baseDate: Date = addDays(todayJst(), 1),
  now: Date = nowJst()
): Date {
  let cursor = startOfDay(baseDate);

  for (let i = 0; i < 370; i += 1) {
    if (canAcceptWebReservation(cursor, { now })) {
      return cursor;
    }
    cursor = addDays(cursor, 1);
  }

  return startOfDay(baseDate);
}

export function normalizeReservationDateInput(value: string | undefined, fallback: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }

  let parsed: Date;
  try {
    parsed = jstDateFromString(value);
  } catch {
    return fallback;
  }

  if (Number.isNaN(parsed.getTime()) || formatJst(parsed) !== value) {
    return fallback;
  }

  if (canAcceptWebReservation(parsed)) {
    return value;
  }

  if (
    isBeforeOpeningReservationDate(parsed) ||
    isSameOrBeforeToday(parsed) ||
    isBeyondRange(parsed)
  ) {
    return fallback;
  }

  return formatJst(getNextBookableReservationDate(parsed));
}

export function getReservationSlots(period: ReservationServicePeriodKey): string[] {
  const config = RESERVATION_CONFIG.servicePeriods[period];
  const slots: string[] = [];
  const startMinutes = timeToMinutes(config.reservationHours.start);
  const endMinutes = timeToMinutes(config.reservationHours.end);

  for (let current = startMinutes; current <= endMinutes; current += config.slotMinutes) {
    slots.push(minutesToTime(current));
  }

  return slots;
}

export function getReservationSlotGroups() {
  return servicePeriodEntries.map(([key, config]) => ({
    key,
    label: config.label,
    slots: getReservationSlots(key),
  }));
}

export function inferReservationServicePeriodFromCourse(
  course?: string | null
): ReservationServicePeriodKey | null {
  if (!course) {
    return null;
  }

  if (course.startsWith("ランチ:")) {
    return "LUNCH";
  }

  if (course.startsWith("ディナー:")) {
    return "DINNER";
  }

  return null;
}

export function inferReservationServicePeriodFromArrivalTime(
  arrivalTime?: string | null
): ReservationServicePeriodKey | null {
  if (!arrivalTime) {
    return null;
  }

  return (
    getReservationSlotGroups().find((group) => group.slots.includes(arrivalTime))?.key ?? null
  );
}

export function getAllowedArrivalTimesForCourse(course?: string | null): string[] {
  const period = inferReservationServicePeriodFromCourse(course);
  if (period) {
    return getReservationSlots(period);
  }

  return getReservationSlotGroups().flatMap((group) => group.slots);
}

export function getAllowedArrivalTimesForServicePeriod(
  servicePeriod?: ReservationServicePeriodKey | null
): string[] {
  if (!servicePeriod) {
    return getReservationSlotGroups().flatMap((group) => group.slots);
  }

  return getReservationSlots(servicePeriod);
}

export function getDefaultArrivalTimeForCourse(
  course?: string | null,
  servicePeriod?: ReservationServicePeriodKey | null
): string {
  const slots =
    course != null
      ? getAllowedArrivalTimesForCourse(course)
      : getAllowedArrivalTimesForServicePeriod(servicePeriod);

  return slots[0] ?? RESERVATION_CONFIG.servicePeriods.DINNER.reservationHours.start;
}

export function isArrivalTimeAllowed(
  arrivalTime?: string | null,
  course?: string | null,
  servicePeriod?: ReservationServicePeriodKey | null
): boolean {
  if (!arrivalTime) {
    return false;
  }

  const coursePeriod = inferReservationServicePeriodFromCourse(course);
  if (coursePeriod) {
    return getAllowedArrivalTimesForCourse(course).includes(arrivalTime);
  }

  return getAllowedArrivalTimesForServicePeriod(servicePeriod).includes(arrivalTime);
}

export function isCourseServicePeriodConsistent(
  course?: string | null,
  servicePeriod?: ReservationServicePeriodKey | null
): boolean {
  const coursePeriod = inferReservationServicePeriodFromCourse(course);
  if (!coursePeriod || !servicePeriod) {
    return true;
  }

  return coursePeriod === servicePeriod;
}

export function getReservationServiceLabel(
  course?: string | null,
  servicePeriod?: ReservationServicePeriodKey | null
): string {
  const period = inferReservationServicePeriodFromCourse(course) ?? servicePeriod;
  return period ? RESERVATION_CONFIG.servicePeriods[period].label : "来店";
}

export function getPrivateBlockMarkerText(
  lunchReason?: string | null,
  dinnerReason?: string | null
): "夜のみ" | "昼のみ" | "終日貸切" | null {
  const nonBookableReasons = new Set([
    "BEFORE_OPENING",
    "OUT_OF_RANGE",
    "CLOSED",
    "SAME_DAY_BLOCKED",
    "CUTOFF_PASSED",
    "INVALID_DATE",
  ]);
  const canShowMarkerForOppositePeriod = (reason?: string | null) =>
    reason == null || !nonBookableReasons.has(reason);

  const lunchPrivateBlock = lunchReason === "PRIVATE_BLOCK";
  const dinnerPrivateBlock = dinnerReason === "PRIVATE_BLOCK";

  if (lunchPrivateBlock && dinnerPrivateBlock) {
    return "終日貸切";
  }

  if (lunchPrivateBlock) {
    return canShowMarkerForOppositePeriod(dinnerReason) ? "夜のみ" : null;
  }

  if (dinnerPrivateBlock) {
    return canShowMarkerForOppositePeriod(lunchReason) ? "昼のみ" : null;
  }

  return null;
}
