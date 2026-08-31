/**
 * P7 / P8: claimAndSendLineReminder pre-send guards.
 *
 * Verifies:
 * - Cancelled reservations → SKIPPED (not sent)
 * - BLOCKED LineFriend → SKIPPED (SKIPPED_BLOCKED status)
 * - lineUserId mismatch → SKIPPED
 * - shouldSendImmediateDayBeforeReminder: only true when JST >= 12:00
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_UID = "U" + "0".repeat(32);
const TARGET_DATE = "2026-06-15";
const pushLineTextMessageMock = vi.hoisted(() => vi.fn());

const BASE_RESERVATION = {
  id: "res-1",
  date: TARGET_DATE,
  arrivalTime: "18:00",
  partySize: 2,
  status: "CONFIRMED",
  reservationType: "NORMAL",
  lineUserId: VALID_UID,
  lineReminderSentAt: null,
};

const BASE_EVENT = {
  id: "evt-1",
  status: "PENDING",
  claimedAt: null,
};

let prismaMock: {
  $transaction: ReturnType<typeof vi.fn>;
  notificationEvent: Record<string, ReturnType<typeof vi.fn>>;
  reservation: Record<string, ReturnType<typeof vi.fn>>;
  lineFriend: Record<string, ReturnType<typeof vi.fn>>;
};

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return prismaMock;
  },
}));

vi.mock("@/lib/line", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    buildReminderRetryKey: vi.fn().mockReturnValue("00000000-0000-0000-0000-000000000000"),
    buildReminderText: vi.fn().mockReturnValue("reminder text"),
    pushLineTextMessage: pushLineTextMessageMock,
    summarizeLineError: vi.fn((e: unknown) => String(e)),
  };
});

const originalEnv = { ...process.env };

beforeEach(() => {
  prismaMock = {
    $transaction: vi.fn(),
    notificationEvent: {
      upsert: vi.fn().mockResolvedValue({ ...BASE_EVENT }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      count: vi.fn().mockResolvedValue(0),
    },
    reservation: {
      findUnique: vi.fn().mockResolvedValue({ ...BASE_RESERVATION }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    lineFriend: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  };
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: unknown) => unknown) =>
      callback({
        $executeRaw: vi.fn().mockResolvedValue(0),
        notificationEvent: {
          count: prismaMock.notificationEvent.count,
          updateMany: prismaMock.notificationEvent.updateMany,
        },
        reservation: {
          updateMany: prismaMock.reservation.updateMany,
        },
      })
  );
  pushLineTextMessageMock.mockReset();
  pushLineTextMessageMock.mockResolvedValue({ ok: true });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "token";
});

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

async function load() {
  vi.resetModules();
  return import("@/lib/line-notification");
}

// ── Pre-send status guard ─────────────────────────────────────────────────────

describe("claimAndSendLineReminder pre-send guards", () => {
  it("returns 'skipped' when reservation is CANCELLED", async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      ...BASE_RESERVATION,
      status: "CANCELLED",
    });
    const { claimAndSendLineReminder } = await load();
    const result = await claimAndSendLineReminder("res-1", VALID_UID, TARGET_DATE, "TEST");
    expect(result).toBe("skipped");
  });

  it("returns 'skipped' when reservation type is PRIVATE_BLOCK", async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      ...BASE_RESERVATION,
      reservationType: "PRIVATE_BLOCK",
    });
    const { claimAndSendLineReminder } = await load();
    const result = await claimAndSendLineReminder("res-1", VALID_UID, TARGET_DATE, "TEST");
    expect(result).toBe("skipped");
  });

  it("returns 'skipped' when lineUserId on reservation differs from caller", async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      ...BASE_RESERVATION,
      lineUserId: "U" + "f".repeat(32),
    });
    const { claimAndSendLineReminder } = await load();
    const result = await claimAndSendLineReminder("res-1", VALID_UID, TARGET_DATE, "TEST");
    expect(result).toBe("skipped");
  });

  it("returns 'skipped' when lineReminderSentAt is already set", async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      ...BASE_RESERVATION,
      lineReminderSentAt: new Date("2026-06-14T03:00:00Z"),
    });
    const { claimAndSendLineReminder } = await load();
    const result = await claimAndSendLineReminder("res-1", VALID_UID, TARGET_DATE, "TEST");
    expect(result).toBe("skipped");
  });

  it("returns 'skipped' when reservation date does not match targetDate", async () => {
    prismaMock.reservation.findUnique.mockResolvedValue({
      ...BASE_RESERVATION,
      date: "2026-06-20",
    });
    const { claimAndSendLineReminder } = await load();
    const result = await claimAndSendLineReminder("res-1", VALID_UID, TARGET_DATE, "TEST");
    expect(result).toBe("skipped");
  });

  it("returns 'skipped' (SKIPPED_BLOCKED) when LineFriend is BLOCKED", async () => {
    prismaMock.lineFriend.findUnique.mockResolvedValue({ friendshipStatus: "BLOCKED" });
    const { claimAndSendLineReminder } = await load();
    const result = await claimAndSendLineReminder("res-1", VALID_UID, TARGET_DATE, "TEST");
    expect(result).toBe("skipped");
    // Notification event should be updated to SKIPPED_BLOCKED.
    const calls = prismaMock.notificationEvent.updateMany.mock.calls;
    const blockCall = calls.find((c) => c[0]?.data?.status === "SKIPPED_BLOCKED");
    expect(blockCall).toBeDefined();
  });

  it("returns 'sent' for a valid CONFIRMED NORMAL reservation with active LineFriend", async () => {
    prismaMock.lineFriend.findUnique.mockResolvedValue({ friendshipStatus: "FRIEND" });
    const { claimAndSendLineReminder } = await load();
    const result = await claimAndSendLineReminder("res-1", VALID_UID, TARGET_DATE, "TEST");
    expect(result).toBe("sent");
  });

  it("returns 'quota' and durably skips at the atomic monthly quota boundary", async () => {
    prismaMock.notificationEvent.count.mockResolvedValue(200);
    const { claimAndSendLineReminder } = await load();

    const result = await claimAndSendLineReminder(
      "res-1",
      VALID_UID,
      TARGET_DATE,
      "CRON",
      { monthlyQuota: 200 }
    );

    expect(result).toBe("quota");
    expect(pushLineTextMessageMock).not.toHaveBeenCalled();
    expect(prismaMock.notificationEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED",
          error: "SKIPPED_QUOTA",
          claimToken: null,
        }),
      })
    );
    expect(prismaMock.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: "res-1" },
      data: {
        lineReminderStatus: "SKIPPED_QUOTA",
        lineReminderError: "LINE monthly quota guard reached",
      },
    });
  });

  it("does not let a stale worker update SENT after the claim fence is lost", async () => {
    prismaMock.notificationEvent.upsert.mockResolvedValueOnce({
      ...BASE_EVENT,
      status: "SENDING",
      claimedAt: new Date(Date.now() - 31 * 60 * 1000),
    });
    prismaMock.notificationEvent.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const { claimAndSendLineReminder } = await load();
    const result = await claimAndSendLineReminder("res-1", VALID_UID, TARGET_DATE, "CRON");

    expect(result).toBe("failed");
    expect(pushLineTextMessageMock).toHaveBeenCalledOnce();
    expect(prismaMock.notificationEvent.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "evt-1",
          status: "SENDING",
          claimToken: expect.any(String),
        }),
      })
    );
  });
});

// ── shouldSendImmediateDayBeforeReminder ──────────────────────────────────────

describe("shouldSendImmediateDayBeforeReminder", () => {
  it("returns false before JST 12:00 (e.g. 11:59 JST = 02:59 UTC)", async () => {
    const { shouldSendImmediateDayBeforeReminder } = await load();
    // 11:59 JST → UTC 02:59
    const before = new Date("2026-06-14T02:59:00Z");
    expect(shouldSendImmediateDayBeforeReminder(before)).toBe(false);
  });

  it("returns true at exactly JST 12:00 (03:00 UTC)", async () => {
    const { shouldSendImmediateDayBeforeReminder } = await load();
    const at = new Date("2026-06-14T03:00:00Z");
    expect(shouldSendImmediateDayBeforeReminder(at)).toBe(true);
  });

  it("returns true after JST 12:00 (e.g. 18:00 JST = 09:00 UTC)", async () => {
    const { shouldSendImmediateDayBeforeReminder } = await load();
    const after = new Date("2026-06-14T09:00:00Z");
    expect(shouldSendImmediateDayBeforeReminder(after)).toBe(true);
  });

  it("returns false at JST 00:00 (= UTC 15:00 previous day) — midnight is before 12:00", async () => {
    const { shouldSendImmediateDayBeforeReminder } = await load();
    const midnight = new Date("2026-06-13T15:00:00Z");
    expect(shouldSendImmediateDayBeforeReminder(midnight)).toBe(false);
  });
});
