import { describe, expect, it } from "vitest";
import { normalizeAdminReservationDateInput } from "@/lib/admin-day-status";

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
