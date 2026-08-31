import { describe, expect, it } from "vitest";
import { ReservationStatus, ReservationType } from "@prisma/client";
import {
  evaluateReservationStatusTransition,
  isReservationStatusTransitionAllowed,
  requiresOperatorForReservationStatusTransition,
} from "@/lib/reservation-status";

const statuses = Object.values(ReservationStatus);

describe("reservation status transition policy", () => {
  it("keeps same-state updates idempotent for every reservation type and status", () => {
    for (const reservationType of Object.values(ReservationType)) {
      for (const status of statuses) {
        expect(
          evaluateReservationStatusTransition({
            reservationType,
            currentStatus: status,
            nextStatus: status,
          })
        ).toBe("NO_OP");
      }
    }
  });

  it("allows normal reservations to move from confirmed to any terminal status", () => {
    for (const nextStatus of [
      ReservationStatus.CANCELLED,
      ReservationStatus.DONE,
      ReservationStatus.NOSHOW,
    ]) {
      expect(
        isReservationStatusTransitionAllowed({
          reservationType: ReservationType.NORMAL,
          currentStatus: ReservationStatus.CONFIRMED,
          nextStatus,
        })
      ).toBe(true);
    }
  });

  it("allows private blocks to move only from confirmed to cancelled", () => {
    expect(
      evaluateReservationStatusTransition({
        reservationType: ReservationType.PRIVATE_BLOCK,
        currentStatus: ReservationStatus.CONFIRMED,
        nextStatus: ReservationStatus.CANCELLED,
      })
    ).toBe("ALLOWED");

    for (const nextStatus of [ReservationStatus.DONE, ReservationStatus.NOSHOW]) {
      expect(
        evaluateReservationStatusTransition({
          reservationType: ReservationType.PRIVATE_BLOCK,
          currentStatus: ReservationStatus.CONFIRMED,
          nextStatus,
        })
      ).toBe("RESERVATION_TYPE_NOT_ALLOWED");
    }
  });

  it("rejects every transition out of a terminal state", () => {
    for (const currentStatus of [
      ReservationStatus.CANCELLED,
      ReservationStatus.DONE,
      ReservationStatus.NOSHOW,
    ]) {
      expect(
        evaluateReservationStatusTransition({
          reservationType: ReservationType.NORMAL,
          currentStatus,
          nextStatus: ReservationStatus.CONFIRMED,
        })
      ).toBe("TERMINAL_STATUS_NOT_ALLOWED");
    }
  });

  it("requires an operator only for private-block release", () => {
    expect(
      requiresOperatorForReservationStatusTransition({
        reservationType: ReservationType.PRIVATE_BLOCK,
        currentStatus: ReservationStatus.CONFIRMED,
        nextStatus: ReservationStatus.CANCELLED,
      })
    ).toBe(true);
    expect(
      requiresOperatorForReservationStatusTransition({
        reservationType: ReservationType.NORMAL,
        currentStatus: ReservationStatus.CONFIRMED,
        nextStatus: ReservationStatus.CANCELLED,
      })
    ).toBe(false);
  });
});
