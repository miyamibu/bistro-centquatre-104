import { ReservationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getReservationStatusLabel } from "@/lib/reservation-labels";

describe("reservation status labels", () => {
  it.each([
    [ReservationStatus.CONFIRMED, "確定"],
    [ReservationStatus.CANCELLED, "キャンセル済み"],
    [ReservationStatus.DONE, "来店済み"],
    [ReservationStatus.NOSHOW, "無断キャンセル"],
  ])("maps %s to the existing Japanese label", (status, label) => {
    expect(getReservationStatusLabel(status)).toBe(label);
  });
});
