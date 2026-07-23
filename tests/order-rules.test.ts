import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPayInStoreVisitDateLiveError,
  getStoreVisitDateRange,
  validatePayInStoreVisitDate,
} from "@/lib/order-rules";

describe("getStoreVisitDateRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the JST date at the midnight boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T14:59:59.999Z"));
    expect(getStoreVisitDateRange()).toEqual({
      minDate: "2026-08-04",
      maxDate: "2026-08-20",
    });

    vi.setSystemTime(new Date("2026-07-21T15:00:00.000Z"));
    expect(getStoreVisitDateRange()).toEqual({
      minDate: "2026-08-05",
      maxDate: "2026-08-21",
    });
  });
});

describe("validatePayInStoreVisitDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a business day inside the visit window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T03:00:00.000Z"));

    expect(validatePayInStoreVisitDate("2026-08-06")).toEqual({ ok: true });
  });

  it("rejects a closed weekday before submission", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T03:00:00.000Z"));

    expect(validatePayInStoreVisitDate("2026-08-05")).toMatchObject({
      ok: false,
      code: "STORE_VISIT_NOT_BUSINESS_DAY",
      error: "来店日は営業日（木〜日）を選択してください",
    });
  });

  it("rejects a calendar date that rolls into another month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T03:00:00.000Z"));

    expect(validatePayInStoreVisitDate("2026-08-32")).toMatchObject({
      ok: false,
      code: "INVALID_STORE_VISIT_DATE",
    });
  });
});

describe("getPayInStoreVisitDateLiveError", () => {
  const range = { minDate: "2026-08-04", maxDate: "2026-08-20" };

  it.each([
    ["", null],
    ["2026-08-32", null],
    ["2026-8-6", null],
    ["2026-08-02", null],
    ["2026-08-22", null],
    ["2026-08-05", "来店日は営業日（木〜日）を選択してください"],
    ["2026-08-06", null],
  ])("classifies %s without duplicating native range validation", (date, expected) => {
    expect(getPayInStoreVisitDateLiveError(date, range)).toBe(expected);
  });
});
