import { describe, expect, it } from "vitest";
import { ReservationStatus, ReservationType } from "@prisma/client";
import {
  buildPeriodStatus,
  normalizeAdminReservationDateInput,
  type AdminDayReservationRow,
} from "@/lib/admin-day-status";

function reservation(
  overrides: Partial<AdminDayReservationRow> = {}
): AdminDayReservationRow {
  return {
    id: "reservation-1",
    date: "2026-06-01",
    servicePeriod: "LUNCH",
    reservationType: ReservationType.NORMAL,
    status: ReservationStatus.CONFIRMED,
    partySize: 2,
    name: "山田 太郎",
    note: null,
    ...overrides,
  };
}

describe("normalizeAdminReservationDateInput", () => {
  it("normalizes non-zero-padded admin reservation dates", () => {
    expect(normalizeAdminReservationDateInput("2026-6-1", "2026-05-21")).toBe("2026-06-01");
  });

  it("keeps already normalized dates", () => {
    expect(normalizeAdminReservationDateInput("2026-06-01", "2026-05-21")).toBe("2026-06-01");
  });

  it("falls back for invalid dates", () => {
    expect(normalizeAdminReservationDateInput("2026-02-30", "2026-05-21")).toBe("2026-05-21");
    expect(normalizeAdminReservationDateInput("not-a-date", "2026-05-21")).toBe("2026-05-21");
  });
});

describe("buildPeriodStatus", () => {
  it("counts only confirmed normal reservations and active private blocks", () => {
    const status = buildPeriodStatus(
      [
        reservation(),
        reservation({ id: "done", status: ReservationStatus.DONE, partySize: 4 }),
        reservation({ id: "noshow", status: ReservationStatus.NOSHOW, partySize: 6 }),
        reservation({
          id: "cancelled-private",
          status: ReservationStatus.CANCELLED,
          reservationType: ReservationType.PRIVATE_BLOCK,
        }),
      ],
      "LUNCH"
    );

    expect(status.privateBlock).toEqual({ active: false, id: null });
    expect(status.reservations).toMatchObject({
      count: 1,
      partyTotal: 2,
      names: ["山田 太郎"],
      lastNames: ["山田"],
    });
  });

  it("recognizes only a confirmed private block as active", () => {
    const status = buildPeriodStatus(
      [
        reservation({
          id: "private",
          reservationType: ReservationType.PRIVATE_BLOCK,
        }),
      ],
      "LUNCH"
    );

    expect(status.privateBlock).toEqual({ active: true, id: "private" });
    expect(status.reservations.count).toBe(0);
  });
});
