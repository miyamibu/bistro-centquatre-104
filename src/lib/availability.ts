import { ReservationStatus, type PrismaClient } from "@prisma/client";
import { getContactPayload } from "@/lib/contact";
import {
  isArrivalTimeAllowed,
  isCourseServicePeriodConsistent,
  canAcceptWebReservation,
} from "@/lib/booking-rules";
import { jstDateFromString } from "@/lib/dates";
import type { ReservationServicePeriodKey } from "@/lib/reservation-config";
import {
  evaluateReservationAvailability,
  type AvailabilityReason,
  type AvailabilityResult,
} from "@/lib/reservation-capacity";
import { PRIVATE_BLOCK_ERROR_MESSAGE } from "@/lib/private-block";
import { findReservationsCompat } from "@/lib/reservation-compat";

export type AvailabilityResponse = AvailabilityResult & {
  callPhone: string;
  callMessage: string;
};
export type MonthlyAvailabilityMap = Record<string, AvailabilityResponse>;

function pad(num: number) {
  return String(num).padStart(2, "0");
}

export async function getAvailability(
  input: {
    date: string;
    servicePeriod: ReservationServicePeriodKey;
    partySize: number;
  },
  prisma: PrismaClient
): Promise<AvailabilityResponse> {
  const { callPhone, callMessage } = getContactPayload();

  const businessDay = await prisma.businessDay.findUnique({
    where: { date: input.date },
  });
  const reservations = await findReservationsCompat(prisma, {
    where: {
      date: input.date,
      servicePeriod: input.servicePeriod,
      status: ReservationStatus.CONFIRMED,
    },
  });

  return {
    ...evaluateReservationAvailability({
      ...input,
      existingReservations: reservations.map((reservation) => ({
        partySize: reservation.partySize,
        status: reservation.status,
        servicePeriod: reservation.servicePeriod,
        reservationType: reservation.reservationType,
      })),
      businessDayClosed: businessDay?.isClosed,
    }),
    callPhone,
    callMessage,
  };
}

export async function getMonthlyAvailability(
  input: {
    month: string;
    servicePeriod: ReservationServicePeriodKey;
    partySize: number;
  },
  prisma: PrismaClient
): Promise<MonthlyAvailabilityMap> {
  const [year, monthNum] = input.month.split("-").map((value) => Number(value));
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const dateKeys = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return `${year}-${pad(monthNum)}-${pad(day)}`;
  });
  const { callPhone, callMessage } = getContactPayload();

  const [businessDays, reservations] = await Promise.all([
    prisma.businessDay.findMany({
      where: {
        date: { in: dateKeys },
        isClosed: true,
      },
      select: { date: true },
    }),
    findReservationsCompat(prisma, {
      where: {
        date: { in: dateKeys },
        servicePeriod: input.servicePeriod,
        status: ReservationStatus.CONFIRMED,
      },
    }),
  ]);

  const closedDates = new Set(businessDays.map((row) => row.date));
  const reservationsByDate = reservations.reduce<
    Record<
      string,
      Array<{
        partySize: number;
        status: ReservationStatus;
        servicePeriod: ReservationServicePeriodKey;
        reservationType: "NORMAL" | "PRIVATE_BLOCK";
      }>
    >
  >((acc, reservation) => {
    const current = acc[reservation.date] ?? [];
    current.push({
      partySize: reservation.partySize,
      status: reservation.status,
      servicePeriod: reservation.servicePeriod,
      reservationType: reservation.reservationType,
    });
    acc[reservation.date] = current;
    return acc;
  }, {});

  return dateKeys.reduce<MonthlyAvailabilityMap>((acc, dateKey) => {
    acc[dateKey] = {
      ...evaluateReservationAvailability({
        date: dateKey,
        servicePeriod: input.servicePeriod,
        partySize: input.partySize,
        existingReservations: reservationsByDate[dateKey] ?? [],
        businessDayClosed: closedDates.has(dateKey),
      }),
      callPhone,
      callMessage,
    };

    return acc;
  }, {});
}

export function isArrivalTimeValid(
  arrival?: string | null,
  servicePeriod?: ReservationServicePeriodKey | null
) {
  if (!arrival || !servicePeriod) return false;

  const [h, m] = arrival.split(":").map((n) => Number(n));
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  if (h > 23 || m > 59 || h < 0 || m < 0) return false;

  return isArrivalTimeAllowed(arrival, undefined, servicePeriod);
}

export function isWithinAcceptance(dateStr: string) {
  const d = jstDateFromString(dateStr);
  return canAcceptWebReservation(d);
}

export function isCoursePeriodConsistent(
  course?: string | null,
  servicePeriod?: ReservationServicePeriodKey | null
) {
  return isCourseServicePeriodConsistent(course, servicePeriod);
}

export function availabilityReasonToError(reason: AvailabilityReason): {
  status: number;
  code: AvailabilityReason;
  error: string;
} {
  switch (reason) {
    case "INVALID_DATE":
      return { status: 400, code: reason, error: "日付形式が不正です" };
    case "BEFORE_OPENING":
      return {
        status: 400,
        code: reason,
        error: "2026-04-03より前のご予約は受け付けていません",
      };
    case "OUT_OF_RANGE":
      return { status: 400, code: reason, error: "予約可能期間外の日付です" };
    case "CLOSED":
      return { status: 400, code: reason, error: "休業日のため予約できません" };
    case "SAME_DAY_BLOCKED":
      return {
        status: 400,
        code: reason,
        error: "当日のオンライン予約は受け付けていません",
      };
    case "CUTOFF_PASSED":
      return {
        status: 400,
        code: reason,
        error: "Web予約は前日17:00で締め切りました。お電話でご相談ください。",
      };
    case "PHONE_ONLY":
      return {
        status: 409,
        code: reason,
        error: "この時間帯はWeb予約を停止しています。お電話でご相談ください。",
      };
    case "PRIVATE_BLOCK":
      return {
        status: 409,
        code: reason,
        error: PRIVATE_BLOCK_ERROR_MESSAGE,
      };
    case "OK":
      return {
        status: 200,
        code: reason,
        error: "",
      };
  }
}
