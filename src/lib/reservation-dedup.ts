import { ReservationStatus, ReservationType, type Reservation } from "@prisma/client";

const DUPLICATE_WINDOW_MS = 60 * 1000;

function collapseWhitespace(value: string) {
  return value.replace(/[\s\u3000]+/g, " ").trim();
}

export function normalizeReservationName(value: string) {
  return collapseWhitespace(value).normalize("NFKC").toLowerCase();
}

export function normalizeReservationPhone(value: string) {
  return value.normalize("NFKC").replace(/\D+/g, "");
}

export function buildReservationDuplicateWindowStart(now: Date) {
  return new Date(now.getTime() - DUPLICATE_WINDOW_MS);
}

export function isDuplicateReservationCandidate(
  reservation: Reservation,
  input: {
    name: string;
    phone: string;
    partySize: number;
  }
) {
  return (
    reservation.status === ReservationStatus.CONFIRMED &&
    reservation.reservationType === ReservationType.NORMAL &&
    reservation.partySize === input.partySize &&
    normalizeReservationName(reservation.name) === normalizeReservationName(input.name) &&
    normalizeReservationPhone(reservation.phone) === normalizeReservationPhone(input.phone)
  );
}
