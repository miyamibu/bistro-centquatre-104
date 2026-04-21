import { addDays } from "date-fns";
import { describe, expect, it } from "vitest";
import { getNextBookableReservationDate } from "@/lib/booking-rules";
import {
  aggregateSlotCounts,
  evaluateReservationAvailability,
  fitsAllowedPattern,
  partySizeToSlotRequirement,
} from "@/lib/reservation-capacity";
import { formatJst, jstDateTimeFromString, todayJst } from "@/lib/dates";

const futureBookableDate = getNextBookableReservationDate(addDays(todayJst(), 7));
const futureBookableDateKey = formatJst(futureBookableDate);
const futureBookableDateNoon = jstDateTimeFromString(
  formatJst(addDays(futureBookableDate, -2)),
  "12:00"
);
const futureBookableDateAfterCutoff = jstDateTimeFromString(
  formatJst(addDays(futureBookableDate, -1)),
  "22:01"
);
const sampleOpenDateA = getNextBookableReservationDate(addDays(todayJst(), 10));
const sampleOpenDateAKey = formatJst(sampleOpenDateA);
const sampleOpenDateANoon = jstDateTimeFromString(
  formatJst(addDays(sampleOpenDateA, -2)),
  "12:00"
);
const sampleOpenDateB = getNextBookableReservationDate(addDays(todayJst(), 20));
const sampleOpenDateBKey = formatJst(sampleOpenDateB);
const sampleOpenDateBNoon = jstDateTimeFromString(
  formatJst(addDays(sampleOpenDateB, -2)),
  "12:00"
);

describe("reservation capacity rules", () => {
  describe("partySizeToSlotRequirement", () => {
    it("maps party sizes into slot requirements", () => {
      expect(partySizeToSlotRequirement(1)).toBe(2);
      expect(partySizeToSlotRequirement(2)).toBe(2);
      expect(partySizeToSlotRequirement(3)).toBe(4);
      expect(partySizeToSlotRequirement(4)).toBe(4);
      expect(partySizeToSlotRequirement(5)).toBe(6);
      expect(partySizeToSlotRequirement(6)).toBe(6);
      expect(partySizeToSlotRequirement(7)).toBe(8);
      expect(partySizeToSlotRequirement(8)).toBe(8);
      expect(partySizeToSlotRequirement(9)).toBe("phone_only");
    });
  });

  describe("aggregateSlotCounts", () => {
    it("ignores cancelled reservations", () => {
      expect(
        aggregateSlotCounts([
          { partySize: 2, status: "CONFIRMED", servicePeriod: "LUNCH" },
          { partySize: 4, status: "CANCELLED", servicePeriod: "LUNCH" },
          { partySize: 7, status: "DONE", servicePeriod: "LUNCH" },
        ])
      ).toEqual({
        slot2: 1,
        slot4: 0,
        slot6: 0,
        slot8: 1,
        hasPhoneOnly: false,
      });
    });

    it("marks phone-only requirements when existing reservations are 9 or more", () => {
      expect(
        aggregateSlotCounts([{ partySize: 10, status: "CONFIRMED", servicePeriod: "DINNER" }])
      ).toEqual({
        slot2: 0,
        slot4: 0,
        slot6: 0,
        slot8: 0,
        hasPhoneOnly: true,
      });
    });
  });

  describe("fitsAllowedPattern", () => {
    it("accepts counts contained by an allowed pattern", () => {
      expect(
        fitsAllowedPattern({
          slot2: 3,
          slot4: 1,
          slot6: 0,
          slot8: 0,
          hasPhoneOnly: false,
        })
      ).toBe(true);
    });

    it("rejects counts outside all allowed patterns", () => {
      expect(
        fitsAllowedPattern({
          slot2: 0,
          slot4: 0,
          slot6: 1,
          slot8: 1,
          hasPhoneOnly: false,
        })
      ).toBe(false);
    });
  });

  describe("evaluateReservationAvailability", () => {
    it("returns BEFORE_OPENING before all other checks", () => {
      expect(
        evaluateReservationAvailability({
          date: "2026-04-02",
          servicePeriod: "LUNCH",
          partySize: 2,
          existingReservations: [],
        })
      ).toEqual({
        reason: "BEFORE_OPENING",
        webBookable: false,
      });
    });

    it("returns CLOSED before SAME_DAY_BLOCKED", () => {
      expect(
        evaluateReservationAvailability({
          date: "2026-04-06",
          servicePeriod: "LUNCH",
          partySize: 2,
          existingReservations: [],
        })
      ).toEqual({
        reason: "CLOSED",
        webBookable: false,
      });
    });

    it("returns CUTOFF_PASSED after date validity checks", () => {
      expect(
        evaluateReservationAvailability({
          date: futureBookableDateKey,
          servicePeriod: "DINNER",
          partySize: 2,
          existingReservations: [],
          now: futureBookableDateAfterCutoff,
        })
      ).toEqual({
        reason: "CUTOFF_PASSED",
        webBookable: false,
      });
    });

    it("does not close lunch by fixed service-period exceptions on 2026-04-25", () => {
      expect(
        evaluateReservationAvailability({
          date: sampleOpenDateAKey,
          servicePeriod: "LUNCH",
          partySize: 2,
          existingReservations: [],
          now: sampleOpenDateANoon,
        })
      ).toEqual({
        reason: "OK",
        webBookable: true,
      });

      expect(
        evaluateReservationAvailability({
          date: sampleOpenDateAKey,
          servicePeriod: "DINNER",
          partySize: 2,
          existingReservations: [],
          now: sampleOpenDateANoon,
        })
      ).toEqual({
        reason: "OK",
        webBookable: true,
      });
    });

    it("does not close lunch by fixed service-period exceptions on 2026-05-10", () => {
      expect(
        evaluateReservationAvailability({
          date: sampleOpenDateBKey,
          servicePeriod: "LUNCH",
          partySize: 2,
          existingReservations: [],
          now: sampleOpenDateBNoon,
        })
      ).toEqual({
        reason: "OK",
        webBookable: true,
      });

      expect(
        evaluateReservationAvailability({
          date: sampleOpenDateBKey,
          servicePeriod: "DINNER",
          partySize: 2,
          existingReservations: [],
          now: sampleOpenDateBNoon,
        })
      ).toEqual({
        reason: "OK",
        webBookable: true,
      });
    });

    it("returns PHONE_ONLY for 9 or more", () => {
      expect(
        evaluateReservationAvailability({
          date: futureBookableDateKey,
          servicePeriod: "DINNER",
          partySize: 9,
          existingReservations: [],
          now: futureBookableDateNoon,
        })
      ).toEqual({
        reason: "PHONE_ONLY",
        webBookable: false,
      });
    });

    it("aggregates only the matching service period", () => {
      expect(
        evaluateReservationAvailability({
          date: futureBookableDateKey,
          servicePeriod: "LUNCH",
          partySize: 2,
          existingReservations: [
            { partySize: 8, status: "CONFIRMED", servicePeriod: "DINNER" },
          ],
          now: futureBookableDateNoon,
        })
      ).toEqual({
        reason: "OK",
        webBookable: true,
      });
    });

    it("returns PRIVATE_BLOCK when the requested service period is blocked", () => {
      expect(
        evaluateReservationAvailability({
          date: futureBookableDateKey,
          servicePeriod: "DINNER",
          partySize: 2,
          existingReservations: [
            {
              partySize: 1,
              status: "CONFIRMED",
              servicePeriod: "DINNER",
              reservationType: "PRIVATE_BLOCK",
            },
          ],
          now: futureBookableDateNoon,
        })
      ).toEqual({
        reason: "PRIVATE_BLOCK",
        webBookable: false,
      });
    });

    it("does not treat another service period's private block as blocked", () => {
      expect(
        evaluateReservationAvailability({
          date: futureBookableDateKey,
          servicePeriod: "LUNCH",
          partySize: 2,
          existingReservations: [
            {
              partySize: 1,
              status: "CONFIRMED",
              servicePeriod: "DINNER",
              reservationType: "PRIVATE_BLOCK",
            },
          ],
          now: futureBookableDateNoon,
        })
      ).toEqual({
        reason: "OK",
        webBookable: true,
      });
    });
  });
});
