import { ReservationStatus, ReservationType } from "@prisma/client";
import type { ReservationServicePeriodKey } from "@/lib/reservation-config";

export const PRIVATE_BLOCK_NAME = "貸切";
export const PRIVATE_BLOCK_ERROR_MESSAGE = "この時間帯は貸切営業のため予約できません";

export function evaluatePrivateBlockSubmission(
  confirmedReservations: Array<{
    reservationType: ReservationType;
    status: ReservationStatus;
  }>
): "NO_OP" | "CONFLICT" | "CREATE" {
  const confirmed = confirmedReservations.filter(
    (reservation) => reservation.status === ReservationStatus.CONFIRMED
  );

  if (confirmed.some((reservation) => reservation.reservationType === ReservationType.PRIVATE_BLOCK)) {
    return "NO_OP";
  }

  if (confirmed.some((reservation) => reservation.reservationType !== ReservationType.PRIVATE_BLOCK)) {
    return "CONFLICT";
  }

  return "CREATE";
}

export function buildPrivateBlockReservationInput(input: {
  date: string;
  servicePeriod: ReservationServicePeriodKey;
  phone?: string;
  note?: string;
}) {
  const normalizedNote = input.note?.trim();
  return {
    date: input.date,
    servicePeriod: input.servicePeriod,
    reservationType: ReservationType.PRIVATE_BLOCK,
    seatType: "MAIN" as const,
    partySize: 1,
    arrivalTime: null,
    name: PRIVATE_BLOCK_NAME,
    phone: input.phone?.trim() || "-",
    note: normalizedNote ? normalizedNote : null,
    status: ReservationStatus.CONFIRMED,
    lineUserId: null,
  };
}
