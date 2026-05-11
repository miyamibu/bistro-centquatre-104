import { describe, expect, it } from "vitest";

describe("line helpers", () => {
  it("buildReminderText omits name/phone/note/allergy info", async () => {
    const { buildReminderText } = await import("@/lib/line");
    const text = buildReminderText({
      date: "2026-05-12",
      arrivalTime: "18:00",
      partySize: 3,
    });
    expect(text).toContain("2026-05-12");
    expect(text).toContain("18:00");
    expect(text).toContain("3名様");
    expect(text).not.toMatch(/090|080|070|アレルギー|要望|TEL|電話番号/);
  });

  it("buildReminderRetryKey produces stable UUID-shaped key for same input", async () => {
    const { buildReminderRetryKey } = await import("@/lib/line");
    const a = buildReminderRetryKey("res-1", "2026-05-12");
    const b = buildReminderRetryKey("res-1", "2026-05-12");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("buildReminderRetryKey changes when targetDate changes (24h boundary)", async () => {
    const { buildReminderRetryKey } = await import("@/lib/line");
    const a = buildReminderRetryKey("res-1", "2026-05-12");
    const b = buildReminderRetryKey("res-1", "2026-05-13");
    expect(a).not.toBe(b);
  });

  it("LINE_USER_ID_REGEX enforces the U[0-9a-f]{32} format", async () => {
    const { LINE_USER_ID_REGEX } = await import("@/lib/line");
    expect(LINE_USER_ID_REGEX.test("U" + "0".repeat(32))).toBe(true);
    expect(LINE_USER_ID_REGEX.test("X" + "0".repeat(32))).toBe(false);
    expect(LINE_USER_ID_REGEX.test("U" + "Z".repeat(32))).toBe(false);
    expect(LINE_USER_ID_REGEX.test("U" + "0".repeat(31))).toBe(false);
  });
});

describe("reservations schema", () => {
  it("ignores client-supplied lineUserId and accepts lineIdToken", async () => {
    const { createReservationSchema } = await import("@/lib/validation");
    const parsed = createReservationSchema.safeParse({
      date: "2026-12-31",
      servicePeriod: "DINNER",
      partySize: 2,
      arrivalTime: "18:00",
      name: "山田 太郎",
      phone: "0901234567",
      lineUserId: "Uattacker-controlled-value",
      lineIdToken: "header.payload.signature",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.lineIdToken).toBe("header.payload.signature");
      // lineUserId is intentionally `unknown` and not used downstream.
      expect("lineUserId" in parsed.data).toBe(true);
    }
  });
});
