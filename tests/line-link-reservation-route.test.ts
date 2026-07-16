/**
 * Tests for /api/line/link-reservation
 *
 * Properties verified:
 * - Safe, non-enumerating error codes (LINK_VALIDATION_FAILED for all input errors)
 * - Existing different lineUserId is never overwritten
 * - Expired / used tokens → same generic code, not specific reason
 * - lineIdToken failure → 401
 * - Schema-not-ready → 503
 * - Rate limit → 429
 * - Immediate reminder triggered for tomorrow's reservation
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const VALID_UID = "U" + "0".repeat(32);
const DIFFERENT_UID = "U" + "1".repeat(32);
const TOMORROW_JST = "2026-06-16";
const FUTURE_EXPIRY = new Date(Date.now() + 48 * 60 * 60 * 1000);

// ── Mocks ───────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
    reservation: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    reservationLineLinkToken: {
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    reservationRateLimitEvent: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
    notificationEvent: {
      upsert: vi.fn().mockResolvedValue({ id: "evt-1", status: "PENDING", claimedAt: null }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/line", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    verifyLineIdToken: vi.fn().mockResolvedValue(VALID_UID),
    hashLineLinkToken: vi.fn().mockReturnValue("hashed-token"),
    canPushToLineUser: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
    normalizeReservationPhone: vi.fn((p: string) => p.replace(/\D/g, "")),
    getPhoneLast4: vi.fn().mockReturnValue("5678"),
    buildReminderRetryKey: vi.fn().mockReturnValue("00000000-0000-0000-0000-000000000000"),
    buildReminderText: vi.fn().mockReturnValue("reminder"),
    pushLineTextMessage: vi.fn().mockResolvedValue({ ok: true }),
    summarizeLineError: vi.fn().mockReturnValue("err"),
  };
});

vi.mock("@/lib/line-notification", () => ({
  claimAndSendLineReminder: vi.fn().mockResolvedValue("skipped"),
  // Default: 12:00 JST has passed, so immediate sends are allowed in these tests.
  shouldSendImmediateDayBeforeReminder: vi.fn().mockReturnValue(true),
  STALE_SENDING_MS: 30 * 60 * 1000,
}));

vi.mock("@/lib/dates", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    todayJst: vi.fn().mockReturnValue(new Date("2026-06-15T10:00:00.000Z")),
    formatJst: vi.fn().mockReturnValue(TOMORROW_JST),
  };
});

// ── Env + helpers ───────────────────────────────────────────────────────────────

const savedEnv = { ...process.env };

beforeEach(async () => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.LINE_LOGIN_CHANNEL_ID = "channel-A";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok";
  process.env.LINE_LINK_TOKEN_PEPPER = "test-pepper";

  // resetAllMocks clears call counts AND implementations, so we re-apply defaults below.
  vi.resetAllMocks();

  const { prisma } = await import("@/lib/prisma");
  type TestMock = ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
  const p = prisma as unknown as {
    $queryRaw: TestMock;
  } & Record<string, Record<string, TestMock>>;

  // Prisma defaults
  p.$queryRaw.mockResolvedValue([]);
  p.reservationRateLimitEvent.count.mockResolvedValue(0);
  p.reservationRateLimitEvent.create.mockResolvedValue({});
  p.reservation.update.mockResolvedValue({});
  p.reservation.findMany.mockResolvedValue([]);
  p.notificationEvent.upsert.mockResolvedValue({ id: "evt-1", status: "PENDING", claimedAt: null });
  p.notificationEvent.updateMany.mockResolvedValue({ count: 1 });
  p.notificationEvent.update.mockResolvedValue({});
  p.reservationLineLinkToken.updateMany.mockResolvedValue({ count: 1 });

  // Default transaction: pass a tx proxy that re-uses the same mock fns.
  (p.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (...a: unknown[]) => unknown) =>
      fn({
        reservationLineLinkToken: {
          findUnique: p.reservationLineLinkToken.findUnique,
          updateMany: p.reservationLineLinkToken.updateMany,
        },
        reservation: {
          findUnique: p.reservation.findUnique,
          updateMany: p.reservation.updateMany,
        },
      })
  );

  // LINE helper defaults
  const { verifyLineIdToken, hashLineLinkToken, canPushToLineUser, getPhoneLast4,
    normalizeReservationPhone, buildReminderRetryKey, buildReminderText,
    pushLineTextMessage, summarizeLineError } = await import("@/lib/line");
  vi.mocked(verifyLineIdToken).mockResolvedValue(VALID_UID);
  vi.mocked(hashLineLinkToken).mockReturnValue("hashed-token");
  vi.mocked(canPushToLineUser).mockResolvedValue({ status: "ACTIVE" });
  vi.mocked(getPhoneLast4).mockReturnValue("5678");
  vi.mocked(normalizeReservationPhone).mockImplementation((ph: string) => ph.replace(/\D/g, ""));
  vi.mocked(buildReminderRetryKey).mockReturnValue("00000000-0000-0000-0000-000000000000");
  vi.mocked(buildReminderText).mockReturnValue("reminder");
  vi.mocked(pushLineTextMessage).mockResolvedValue({ ok: true });
  vi.mocked(summarizeLineError).mockReturnValue("err");

  // Notification defaults
  const { claimAndSendLineReminder, shouldSendImmediateDayBeforeReminder } = await import("@/lib/line-notification");
  vi.mocked(claimAndSendLineReminder).mockResolvedValue("skipped");
  // Default to 12:00 JST passed so immediate sends are enabled in tests.
  vi.mocked(shouldSendImmediateDayBeforeReminder).mockReturnValue(true);

  // Dates defaults (resetAllMocks clears these too)
  const { todayJst, formatJst } = await import("@/lib/dates");
  vi.mocked(todayJst).mockReturnValue(new Date("2026-06-15T10:00:00.000Z"));
  vi.mocked(formatJst).mockReturnValue(TOMORROW_JST);
});

afterEach(() => {
  process.env = { ...savedEnv };
});

function post(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/line/link-reservation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

const BASE_TOKEN_RECORD = {
  id: "tok-1",
  tokenHash: "hashed-token",
  reservationId: "res-1",
  usedAt: null,
  expiresAt: FUTURE_EXPIRY,
  reservation: {
    id: "res-1",
    phone: "09012345678",
    status: "CONFIRMED" as const,
    reservationType: "NORMAL" as const,
    lineUserId: null as string | null,
  },
};

const LOOKUP_BODY = {
  date: "2026-06-20",
  phone: "090-1234-5678",
  nameFragment: "田中",
  lineIdToken: "id.tok",
};
const MATCHING_RES = {
  id: "res-1",
  phone: "09012345678",
  name: "田中 太郎",
  lineUserId: null as string | null,
  status: "CONFIRMED" as const,
  reservationType: "NORMAL" as const,
};

async function loadRoute() {
  return import("@/app/api/line/link-reservation/route");
}

// ── Token flow ──────────────────────────────────────────────────────────────────

describe("token flow", () => {
  const validBody = { token: "valid-token", phoneLast4: "5678", lineIdToken: "id.tok" };

  it("links reservation and returns ok=true", async () => {
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservationLineLinkToken.findUnique.mockResolvedValue({ ...BASE_TOKEN_RECORD });
    p.reservationLineLinkToken.updateMany.mockResolvedValue({ count: 1 });
    p.reservation.updateMany.mockResolvedValue({ count: 1 });

    const { POST } = await loadRoute();
    const res = await POST(post(validBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.lineNotification.enabled).toBe(true);
  });

  it("returns 400 LINK_VALIDATION_FAILED for expired token — same code as other errors", async () => {
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservationLineLinkToken.findUnique.mockResolvedValue({
      ...BASE_TOKEN_RECORD,
      expiresAt: new Date(Date.now() - 1000),
    });

    const { POST } = await loadRoute();
    const res = await POST(post(validBody));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("LINK_VALIDATION_FAILED");
    expect(body.code).not.toMatch(/EXPIRE|TOKEN_INVALID/i);
  });

  it("returns 400 LINK_VALIDATION_FAILED for already-used token", async () => {
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservationLineLinkToken.findUnique.mockResolvedValue({
      ...BASE_TOKEN_RECORD,
      usedAt: new Date(),
      reservation: { ...BASE_TOKEN_RECORD.reservation, lineUserId: DIFFERENT_UID },
    });

    const { POST } = await loadRoute();
    const body = await (await POST(post(validBody))).json();
    expect(body.code).toBe("LINK_VALIDATION_FAILED");
    expect(body.code).not.toMatch(/USED|ALREADY/i);
  });

  it("returns 400 LINK_VALIDATION_FAILED for wrong phone — same code, no hint about which field", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { getPhoneLast4 } = await import("@/lib/line");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    vi.mocked(getPhoneLast4).mockReturnValue("9999"); // reservation's last4
    p.reservationLineLinkToken.findUnique.mockResolvedValue({ ...BASE_TOKEN_RECORD });

    const { POST } = await loadRoute();
    const res = await POST(post({ ...validBody, phoneLast4: "5678" })); // caller sends wrong digits
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("LINK_VALIDATION_FAILED");
    expect(body.code).not.toContain("PHONE");
  });

  it("returns 409 LINK_VALIDATION_FAILED when a different lineUserId is already set, reservation NOT updated", async () => {
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservationLineLinkToken.findUnique.mockResolvedValue({
      ...BASE_TOKEN_RECORD,
      reservation: { ...BASE_TOKEN_RECORD.reservation, lineUserId: DIFFERENT_UID },
    });
    p.reservationLineLinkToken.updateMany.mockResolvedValue({ count: 1 });

    const { POST } = await loadRoute();
    const res = await POST(post(validBody));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("LINK_VALIDATION_FAILED");
    // Reservation must NOT have been written.
    expect(p.reservation.updateMany).not.toHaveBeenCalled();
  });

  it("returns 401 LINE_ID_TOKEN_INVALID when lineIdToken is invalid", async () => {
    const { verifyLineIdToken } = await import("@/lib/line");
    vi.mocked(verifyLineIdToken).mockResolvedValue(null);

    const { POST } = await loadRoute();
    const res = await POST(post(validBody));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("LINE_ID_TOKEN_INVALID");
  });

  it("does not consume token or link reservation when LINE push status is pending", async () => {
    const { canPushToLineUser } = await import("@/lib/line");
    vi.mocked(canPushToLineUser).mockResolvedValue({ status: "PENDING_CHECK" });
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

    const { POST } = await loadRoute();
    const res = await POST(post(validBody));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("LINK_VALIDATION_FAILED");
    expect(p.reservationLineLinkToken.updateMany).not.toHaveBeenCalled();
    expect(p.reservation.updateMany).not.toHaveBeenCalled();
  });

  it("returns 503 when LINE link schema is not ready", async () => {
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, ReturnType<typeof vi.fn>>;
    p.$queryRaw.mockRejectedValue(
      Object.assign(new Error("relation ReservationLineLinkToken does not exist"), {
        code: "P2021",
      })
    );

    const { POST } = await loadRoute();
    expect((await POST(post(validBody))).status).toBe(503);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservationRateLimitEvent.count.mockResolvedValue(10);

    const { POST } = await loadRoute();
    expect((await POST(post(validBody))).status).toBe(429);
  });

  it("sends immediate reminder when linked reservation is tomorrow", async () => {
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    const { claimAndSendLineReminder } = await import("@/lib/line-notification");

    p.reservationLineLinkToken.findUnique.mockResolvedValue({ ...BASE_TOKEN_RECORD });
    p.reservationLineLinkToken.updateMany.mockResolvedValue({ count: 1 });
    p.reservation.updateMany.mockResolvedValue({ count: 1 });
    p.reservation.findUnique.mockResolvedValue({
      id: "res-1",
      date: TOMORROW_JST,
      lineReminderSentAt: null,
    });
    vi.mocked(claimAndSendLineReminder).mockResolvedValue("sent");

    const { POST } = await loadRoute();
    const body = await (await POST(post(validBody))).json();

    expect(body.lineNotification.immediateReminderSent).toBe(true);
    expect(claimAndSendLineReminder).toHaveBeenCalledOnce();
  });
});

// ── Lookup flow ──────────────────────────────────────────────────────────────────

describe("lookup flow", () => {
  it("is disabled by default", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post(LOOKUP_BODY));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("LINE_LOOKUP_LINK_DISABLED");
  });

  it("returns 400 LINK_VALIDATION_FAILED when nameFragment is only one character", async () => {
    process.env.LINE_RESERVATION_LOOKUP_LINK_ENABLED = "true";
    const { POST } = await loadRoute();
    const res = await POST(post({ ...LOOKUP_BODY, nameFragment: "田" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("LINK_VALIDATION_FAILED");
  });

  it("links when exactly one reservation matches", async () => {
    process.env.LINE_RESERVATION_LOOKUP_LINK_ENABLED = "true";
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservation.findMany.mockResolvedValue([MATCHING_RES]);
    p.reservation.updateMany.mockResolvedValue({ count: 1 });
    p.reservation.findUnique.mockResolvedValue({ id: "res-1", lineUserId: null });

    const { POST } = await loadRoute();
    const res = await POST(post(LOOKUP_BODY));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns 400 LINK_VALIDATION_FAILED for zero matches — not NO_UNIQUE_MATCH", async () => {
    process.env.LINE_RESERVATION_LOOKUP_LINK_ENABLED = "true";
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservation.findMany.mockResolvedValue([]);

    const { POST } = await loadRoute();
    const res = await POST(post(LOOKUP_BODY));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("LINK_VALIDATION_FAILED");
    expect(body.code).not.toMatch(/UNIQUE|MATCH|FOUND/i);
  });

  it("returns 400 LINK_VALIDATION_FAILED for multiple matches — same code as zero matches", async () => {
    process.env.LINE_RESERVATION_LOOKUP_LINK_ENABLED = "true";
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservation.findMany.mockResolvedValue([
      MATCHING_RES,
      { ...MATCHING_RES, id: "res-2", name: "田中 花子" },
    ]);

    const { POST } = await loadRoute();
    const body = await (await POST(post(LOOKUP_BODY))).json();
    expect(body.code).toBe("LINK_VALIDATION_FAILED");
  });

  it("returns 409 and does NOT update when a different lineUserId is already set", async () => {
    process.env.LINE_RESERVATION_LOOKUP_LINK_ENABLED = "true";
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservation.findMany.mockResolvedValue([
      { ...MATCHING_RES, lineUserId: DIFFERENT_UID },
    ]);

    const { POST } = await loadRoute();
    const res = await POST(post(LOOKUP_BODY));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(p.reservation.updateMany).not.toHaveBeenCalled();
    expect(body.code).toBe("LINK_VALIDATION_FAILED");
  });
});

// ── P9: rate limit fail-closed ────────────────────────────────────────────────

describe("rate limit fail-closed (P9)", () => {
  const tokenBody = { token: "valid-token", phoneLast4: "5678", lineIdToken: "id.tok" };

  it("returns 503 when rate limit DB check throws (fail-closed, not fail-open)", async () => {
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservationRateLimitEvent.count.mockRejectedValue(new Error("DB connection lost"));

    const { POST } = await loadRoute();
    const res = await POST(post(tokenBody));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("RATE_LIMIT_CHECK_FAILED");
  });
});

// ── Security ──────────────────────────────────────────────────────────────────

describe("security", () => {
  it("does not log raw token, lineIdToken, phone, or lineUserId", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    );

    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    p.reservationLineLinkToken.findUnique.mockResolvedValue({ ...BASE_TOKEN_RECORD });
    p.reservationLineLinkToken.updateMany.mockResolvedValue({ count: 1 });
    p.reservation.updateMany.mockResolvedValue({ count: 1 });

    const { POST } = await loadRoute();
    await POST(
      post({ token: "SECRET-RAW-TOKEN", phoneLast4: "5678", lineIdToken: "SECRET-ID-TOKEN" })
    );

    const allOutput = spies
      .flatMap((s) => s.mock.calls)
      .flat()
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join("\n");

    expect(allOutput).not.toContain("SECRET-RAW-TOKEN");
    expect(allOutput).not.toContain("SECRET-ID-TOKEN");
    expect(allOutput).not.toContain(VALID_UID);

    spies.forEach((s) => s.mockRestore());
  });
});
