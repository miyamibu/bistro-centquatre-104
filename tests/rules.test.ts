import { addDays, addMonths } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  canAcceptWebReservation,
  getAllowedArrivalTimesForServicePeriod,
  getNextBookableReservationDate,
  getPrivateBlockMarkerText,
  getReservationCutoffDate,
  isBeforeOpeningReservationDate,
  isClosedReservationWeekday,
} from "@/lib/booking-rules";
import { isArrivalTimeValid, isCoursePeriodConsistent, isWithinAcceptance } from "@/lib/availability";
import {
  formatJst,
  jstDateFromString,
  jstDateTimeFromString,
  todayJst,
} from "@/lib/dates";

describe("Availability Rules", () => {
  describe("isArrivalTimeValid", () => {
    it("accepts valid lunch reservation slots", () => {
      expect(isArrivalTimeValid("11:30", "LUNCH")).toBe(true);
      expect(isArrivalTimeValid("12:30", "LUNCH")).toBe(true);
    });

    it("accepts valid dinner reservation slots", () => {
      expect(isArrivalTimeValid("17:30", "DINNER")).toBe(true);
      expect(isArrivalTimeValid("19:30", "DINNER")).toBe(true);
    });

    it("rejects slots outside the configured reservation windows", () => {
      expect(isArrivalTimeValid("10:30", "LUNCH")).toBe(false);
      expect(isArrivalTimeValid("11:00", "LUNCH")).toBe(false);
      expect(isArrivalTimeValid("14:00", "LUNCH")).toBe(false);
      expect(isArrivalTimeValid("20:30", "DINNER")).toBe(false);
    });

    it("rejects invalid format and missing values", () => {
      expect(isArrivalTimeValid("not-time", "DINNER")).toBe(false);
      expect(isArrivalTimeValid("25:00", "DINNER")).toBe(false);
      expect(isArrivalTimeValid(null, "DINNER")).toBe(false);
      expect(isArrivalTimeValid(undefined, "DINNER")).toBe(false);
    });
  });

  describe("course and service period consistency", () => {
    it("accepts matching course periods", () => {
      expect(isCoursePeriodConsistent("ランチ: 席のみ", "LUNCH")).toBe(true);
      expect(isCoursePeriodConsistent("ディナー: 席のみ", "DINNER")).toBe(true);
    });

    it("rejects mismatched course periods", () => {
      expect(isCoursePeriodConsistent("ランチ: 席のみ", "DINNER")).toBe(false);
      expect(isCoursePeriodConsistent("ディナー: 席のみ", "LUNCH")).toBe(false);
    });
  });

  describe("isWithinAcceptance", () => {
    it("rejects dates before opening", () => {
      expect(isWithinAcceptance("2026-04-02")).toBe(false);
    });

    it("accepts the next bookable date", () => {
      const nextBookable = formatJst(getNextBookableReservationDate());
      expect(isWithinAcceptance(nextBookable)).toBe(true);
    });

    it("accepts dates within 3 months", () => {
      const date30d = getNextBookableReservationDate(addDays(todayJst(), 30));
      expect(isWithinAcceptance(formatJst(date30d))).toBe(true);
    });

    it("handles the 3-month boundary with weekday rules", () => {
      const dateAtBoundary = addMonths(todayJst(), 3);
      expect(isWithinAcceptance(formatJst(dateAtBoundary))).toBe(
        !isBeforeOpeningReservationDate(dateAtBoundary) &&
          !isClosedReservationWeekday(dateAtBoundary)
      );
    });

    it("rejects beyond 3 months", () => {
      const dateBeyondBoundary = formatJst(
        new Date(addMonths(todayJst(), 3).getTime() + 86400000)
      );
      expect(isWithinAcceptance(dateBeyondBoundary)).toBe(false);
    });

    it("rejects past dates", () => {
      const yesterday = formatJst(new Date(todayJst().getTime() - 86400000));
      expect(isWithinAcceptance(yesterday)).toBe(false);
    });
  });

  describe("Reservation slots", () => {
    it("returns lunch slots only for lunch service", () => {
      expect(getAllowedArrivalTimesForServicePeriod("LUNCH")).toEqual([
        "11:30",
        "12:00",
        "12:30",
      ]);
    });

    it("returns dinner slots only for dinner service", () => {
      expect(getAllowedArrivalTimesForServicePeriod("DINNER")).toEqual([
        "17:30",
        "18:00",
        "18:30",
        "19:00",
        "19:30",
      ]);
    });
  });

  describe("Business day rules", () => {
    it("handles valid date formatting", () => {
      const dateStr = "2026-04-03";
      const parsed = jstDateFromString(dateStr);
      const formatted = formatJst(parsed);
      expect(formatted).toBe(dateStr);
    });

    it("treats Monday, Tuesday, and Wednesday as closed reservation weekdays", () => {
      expect(isClosedReservationWeekday(jstDateFromString("2026-03-09"))).toBe(true);
      expect(isClosedReservationWeekday(jstDateFromString("2026-03-10"))).toBe(true);
      expect(isClosedReservationWeekday(jstDateFromString("2026-03-11"))).toBe(true);
      expect(isClosedReservationWeekday(jstDateFromString("2026-03-12"))).toBe(false);
    });

    it("moves to Thursday when starting from a closed Monday", () => {
      let nextMonday = addDays(todayJst(), 1);
      while (nextMonday.getDay() !== 1) {
        nextMonday = addDays(nextMonday, 1);
      }

      const nextBookable = getNextBookableReservationDate(nextMonday);
      expect(nextBookable.getDay()).not.toBe(1);
      expect(nextBookable.getDay()).not.toBe(2);
      expect(nextBookable.getDay()).not.toBe(3);
      expect(formatJst(nextBookable) >= "2026-04-03").toBe(true);
    });

    it("rejects closed weekdays for web reservations", () => {
      let nextMonday = addDays(todayJst(), 1);
      while (nextMonday.getDay() !== 1) {
        nextMonday = addDays(nextMonday, 1);
      }

      expect(canAcceptWebReservation(nextMonday)).toBe(false);
    });
  });

  describe("Cutoff rules", () => {
    it("builds the previous-day 17:00 cutoff timestamp", () => {
      const reservationDate = jstDateFromString("2026-04-10");
      expect(getReservationCutoffDate(reservationDate).toISOString()).toBe(
        "2026-04-09T08:00:00.000Z"
      );
    });

    it("rejects a reservation date after the cutoff has passed", () => {
      const reservationDate = getNextBookableReservationDate(addDays(todayJst(), 7));
      const previousDay = formatJst(addDays(reservationDate, -1));
      const afterCutoff = jstDateTimeFromString(previousDay, "17:30");
      expect(canAcceptWebReservation(reservationDate, { now: afterCutoff })).toBe(false);
    });

    it("accepts a reservation date before the cutoff passes", () => {
      const reservationDate = getNextBookableReservationDate(addDays(todayJst(), 7));
      const previousDay = formatJst(addDays(reservationDate, -1));
      const beforeCutoff = jstDateTimeFromString(previousDay, "16:59");
      expect(canAcceptWebReservation(reservationDate, { now: beforeCutoff })).toBe(true);
    });
  });

  describe("Private block marker text", () => {
    it("returns 昼のみ for dinner-only private block when lunch is available", () => {
      expect(getPrivateBlockMarkerText("OK", "PRIVATE_BLOCK")).toBe("昼のみ");
    });

    it("does not return 昼のみ when lunch is closed", () => {
      expect(getPrivateBlockMarkerText("CLOSED", "PRIVATE_BLOCK")).toBeNull();
    });

    it("returns 夜のみ for lunch-only private block when dinner is available", () => {
      expect(getPrivateBlockMarkerText("PRIVATE_BLOCK", "OK")).toBe("夜のみ");
    });

    it("does not return 夜のみ when dinner is closed", () => {
      expect(getPrivateBlockMarkerText("PRIVATE_BLOCK", "CLOSED")).toBeNull();
    });
  });
});
