import { describe, expect, it } from "vitest";
import { evaluateSelfServiceCancellation } from "@/lib/cancellation-policy";

describe("self-service cancellation policy", () => {
  it("allows cancellation before the 24-hour JST cutoff", () => {
    const decision = evaluateSelfServiceCancellation({
      date: "2026-08-15",
      arrivalTime: "18:00",
      now: new Date("2026-08-14T08:59:59.000Z"),
    });

    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.cutoffAt.toISOString()).toBe("2026-08-14T09:00:00.000Z");
    }
  });

  it("rejects cancellation at and after the cutoff", () => {
    const decision = evaluateSelfServiceCancellation({
      date: "2026-08-15",
      arrivalTime: "18:00",
      now: new Date("2026-08-14T09:00:00.000Z"),
    });

    expect(decision).toMatchObject({ allowed: false, code: "CANCELLATION_CUTOFF_PASSED" });
  });

  it("fails closed when the stored arrival time is unavailable or invalid", () => {
    expect(
      evaluateSelfServiceCancellation({
        date: "2026-08-15",
        arrivalTime: null,
        now: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).toMatchObject({ allowed: false, code: "CANCELLATION_POLICY_UNAVAILABLE" });

    expect(
      evaluateSelfServiceCancellation({
        date: "2026-02-30",
        arrivalTime: "18:00",
        now: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ).toMatchObject({ allowed: false, code: "CANCELLATION_POLICY_UNAVAILABLE" });
  });
});
