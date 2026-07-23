import { describe, expect, it } from "vitest";
import {
  findFirstWebBookableDate,
  isExplicitReservationDateUsable,
  shouldSearchFutureAvailability,
} from "@/lib/reservation-form-defaults";

const referenceDate = new Date("2026-07-21T12:00:00+09:00");

describe("isExplicitReservationDateUsable", () => {
  it("accepts a valid explicit date using the supplied reference date", () => {
    expect(isExplicitReservationDateUsable("2026-07-23", referenceDate)).toBe(true);
  });

  it("rejects a calendar date that does not exist", () => {
    expect(isExplicitReservationDateUsable("2026-02-31", referenceDate)).toBe(false);
  });

  it("rejects past and out-of-range dates using the supplied reference date", () => {
    expect(isExplicitReservationDateUsable("2026-07-20", referenceDate)).toBe(false);
    expect(isExplicitReservationDateUsable("2026-10-22", referenceDate)).toBe(false);
  });
});

describe("shouldSearchFutureAvailability", () => {
  it("searches only within the web reservation party-size limit", () => {
    expect(shouldSearchFutureAvailability(8)).toBe(true);
    expect(shouldSearchFutureAvailability(9)).toBe(false);
  });
});

describe("findFirstWebBookableDate", () => {
  it("returns the earliest DB-confirmed web-bookable date on or after the requested date", () => {
    expect(
      findFirstWebBookableDate(
        {
          "2026-07-25": { webBookable: true },
          "2026-07-23": { webBookable: false },
          "2026-07-24": { webBookable: true },
        },
        "2026-07-23"
      )
    ).toBe("2026-07-24");
  });

  it("does not move backward or select a non-bookable date", () => {
    expect(
      findFirstWebBookableDate(
        {
          "2026-07-22": { webBookable: true },
          "2026-07-23": { webBookable: false },
        },
        "2026-07-23"
      )
    ).toBeNull();
  });
});
