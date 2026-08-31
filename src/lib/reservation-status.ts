import { ReservationStatus, ReservationType } from "@prisma/client";

export const TERMINAL_RESERVATION_STATUSES = new Set<ReservationStatus>([
  ReservationStatus.CANCELLED,
  ReservationStatus.DONE,
  ReservationStatus.NOSHOW,
]);

export type ReservationStatusTransitionResult =
  | "NO_OP"
  | "ALLOWED"
  | "TERMINAL_STATUS_NOT_ALLOWED"
  | "RESERVATION_TYPE_NOT_ALLOWED";

export type ReservationStatusTransitionInput = {
  reservationType: ReservationType;
  currentStatus: ReservationStatus;
  nextStatus: ReservationStatus;
};

/**
 * Server-side source of truth for reservation status transitions.
 * PRIVATE_BLOCK records only represent an active block or its release;
 * they must never be marked as a visit or a no-show.
 */
export function evaluateReservationStatusTransition({
  reservationType,
  currentStatus,
  nextStatus,
}: ReservationStatusTransitionInput): ReservationStatusTransitionResult {
  if (currentStatus === nextStatus) {
    return "NO_OP";
  }

  if (TERMINAL_RESERVATION_STATUSES.has(currentStatus)) {
    return "TERMINAL_STATUS_NOT_ALLOWED";
  }

  if (
    reservationType === ReservationType.PRIVATE_BLOCK &&
    (currentStatus !== ReservationStatus.CONFIRMED ||
      nextStatus !== ReservationStatus.CANCELLED)
  ) {
    return "RESERVATION_TYPE_NOT_ALLOWED";
  }

  return "ALLOWED";
}

export function isReservationStatusTransitionAllowed(
  input: ReservationStatusTransitionInput
): boolean {
  const result = evaluateReservationStatusTransition(input);
  return result === "NO_OP" || result === "ALLOWED";
}

export function requiresOperatorForReservationStatusTransition({
  reservationType,
  currentStatus,
  nextStatus,
}: ReservationStatusTransitionInput): boolean {
  return (
    reservationType === ReservationType.PRIVATE_BLOCK &&
    currentStatus === ReservationStatus.CONFIRMED &&
    nextStatus === ReservationStatus.CANCELLED
  );
}
