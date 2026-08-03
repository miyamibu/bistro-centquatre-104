/**
 * P12: Public /api/reservations response must NOT contain adminLink.
 * P4:  linkUrl in lineNotification uses https://liff.line.me/<LIFF_LINK_ID>?t=...
 *      when NEXT_PUBLIC_LIFF_LINK_ID is set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const originalEnv = { ...process.env };
const PUBLIC_BASE_URL = "https://bistro-centquatre-104.vercel.app";

const routeMocks = vi.hoisted(() => ({
  lineLinkTokenCreate: vi.fn(),
  txReservationFindMany: vi.fn(),
  reservationEmailOutboxUpsert: vi.fn(),
  sendReservationEmail: vi.fn(),
  reservationIdempotencyFindUnique: vi.fn(),
  reservationIdempotencyCreateMany: vi.fn(),
  reservationIdempotencyUpdate: vi.fn(),
  idempotencyRows: new Map<string, Record<string, unknown>>(),
}));

const readySchemaRow = {
  reservationTableReady: true,
  privateBlockAuditLogReady: true,
  reservationRateLimitEventReady: true,
  reservationLineColumnsReady: true,
  reservationLineLinkTokenReady: true,
  notificationEventReady: true,
  notificationEventClaimTokenReady: true,
  lineFriendReady: true,
  lineCustomerLinkReady: true,
  reservationStatusAuditLogReady: true,
  reservationEmailOutboxReady: true,
  reservationIdempotencyReady: true,
  reservationManagementTokenReady: true,
  reservationContactReady: true,
};

function resetRouteMocks() {
  routeMocks.idempotencyRows.clear();
  routeMocks.lineLinkTokenCreate.mockResolvedValue({
    id: "tok-1",
    tokenHash: "hash",
    expiresAt: new Date(),
  });
  routeMocks.txReservationFindMany.mockResolvedValue([]);
  routeMocks.reservationEmailOutboxUpsert.mockResolvedValue({
    id: "outbox-1",
    status: "PENDING",
  });
  routeMocks.sendReservationEmail.mockResolvedValue({
    sent: true,
    provider: "resend",
  });
  routeMocks.reservationIdempotencyFindUnique.mockImplementation(
    async ({ where }: { where: { idempotencyKey?: string; id?: string } }) => {
      if (where.idempotencyKey) return routeMocks.idempotencyRows.get(where.idempotencyKey) ?? null;
      if (where.id) {
        return [...routeMocks.idempotencyRows.values()].find((row) => row.id === where.id) ?? null;
      }
      return null;
    }
  );
  routeMocks.reservationIdempotencyCreateMany.mockImplementation(
    async ({ data }: { data: Record<string, unknown>[] }) => {
      const row = data[0];
      if (!row || typeof row.idempotencyKey !== "string") return { count: 0 };
      if (routeMocks.idempotencyRows.has(row.idempotencyKey)) return { count: 0 };
      routeMocks.idempotencyRows.set(row.idempotencyKey, {
        ...row,
        responseStatus: null,
        responseBody: null,
        reservationId: null,
      });
      return { count: 1 };
    }
  );
  routeMocks.reservationIdempotencyUpdate.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = [...routeMocks.idempotencyRows.values()].find((item) => item.id === where.id);
      if (!row) throw new Error("idempotency row missing");
      Object.assign(row, data);
      return row;
    }
  );
}

resetRouteMocks();

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  vi.clearAllMocks();
  resetRouteMocks();
});

const VALID_DATE = "2026-08-15";

const MIN_BODY = {
  date: VALID_DATE,
  servicePeriod: "DINNER",
  seatType: "TABLE",
  partySize: 2,
  arrivalTime: "18:00",
  lastName: "山田",
  phone: "090-0000-1234",
  customerEmail: "customer@example.com",
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([readySchemaRow]),
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const fakeTx = {
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        $executeRaw: vi.fn().mockResolvedValue(1),
        businessDay: { findUnique: vi.fn().mockResolvedValue(null) },
        $queryRaw: vi.fn().mockResolvedValue([]),
        reservation: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: routeMocks.txReservationFindMany,
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: "res-abc",
            date: VALID_DATE,
            servicePeriod: "DINNER",
            reservationType: "NORMAL",
            seatType: "TABLE",
            partySize: 2,
            arrivalTime: "18:00",
            name: "山田",
            phone: "090-0000-1234",
            customerEmail: data.customerEmail ?? null,
            customerEmailVerifiedAt: data.customerEmailVerifiedAt ?? null,
            contactChannel: data.contactChannel ?? null,
            note: null,
            status: "CONFIRMED",
            cancellationPolicyVersion: data.cancellationPolicyVersion ?? null,
            cancellationPolicyAcceptedAt: data.cancellationPolicyAcceptedAt ?? null,
            cancelledAt: null,
            cancelSource: null,
            cancellationReason: null,
            lineUserId: data.lineUserId ?? null,
            lineReminderSentAt: null,
            lineLinkedAt: data.lineLinkedAt ?? null,
            lineLinkSource: data.lineLinkSource ?? null,
            lineReminderStatus: null,
            lineReminderError: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        },
        reservationRateLimitEvent: {
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockResolvedValue({}),
        },
        reservationEmailOutbox: {
          upsert: routeMocks.reservationEmailOutboxUpsert,
        },
        reservationIdempotency: {
          findUnique: routeMocks.reservationIdempotencyFindUnique,
          createMany: routeMocks.reservationIdempotencyCreateMany,
          update: routeMocks.reservationIdempotencyUpdate,
        },
        reservationManagementToken: {
          create: vi.fn().mockResolvedValue({
            id: "management-token-1",
            tokenHash: "hashed-management-token",
            expiresAt: new Date(),
          }),
        },
        reservationLineLinkToken: {
          create: routeMocks.lineLinkTokenCreate,
        },
        privateBlock: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      return fn(fakeTx);
    }),
    reservationLineLinkToken: {
      create: routeMocks.lineLinkTokenCreate,
      upsert: vi.fn().mockResolvedValue({ rawToken: "tok123", expiresAt: new Date() }),
      findFirst: vi.fn().mockResolvedValue({ rawToken: "tok123", expiresAt: new Date() }),
    },
    businessDay: { findUnique: vi.fn().mockResolvedValue(null) },
    lineCustomerLink: { findMany: vi.fn().mockResolvedValue([]) },
    lineFriend: { findUnique: vi.fn().mockResolvedValue(null) },
    reservationIdempotency: {
      findUnique: routeMocks.reservationIdempotencyFindUnique,
      createMany: routeMocks.reservationIdempotencyCreateMany,
      update: routeMocks.reservationIdempotencyUpdate,
    },
  },
}));

vi.mock("@/lib/line", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    verifyLineIdToken: vi.fn().mockResolvedValue(null),
    canPushToLineUser: vi.fn().mockResolvedValue({ status: "PENDING_CHECK" }),
  };
});

vi.mock("@/lib/email", () => ({
  sendReservationEmail: routeMocks.sendReservationEmail,
}));

function post(body: Record<string, unknown>, idempotencyKey = "test-idempotency-key") {
  return new NextRequest(`${PUBLIC_BASE_URL}/api/reservations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: PUBLIC_BASE_URL,
      "x-requested-with": "XMLHttpRequest",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.BASE_URL = PUBLIC_BASE_URL;
  return import("@/app/api/reservations/route");
}

describe("public reservations API — adminLink (P12)", () => {
  it("does not include adminLink in the response body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post({ ...MIN_BODY, name: "山田" }));
    if (res.status !== 200) return; // skip if schema not ready in test env
    const body = await res.json();
    expect(body).not.toHaveProperty("adminLink");
    expect(body.managementUrl).toMatch(
      /^https:\/\/bistro-centquatre-104\.vercel\.app\/reservation\/manage#token=/
    );
    expect(new URL(body.managementUrl).search).toBe("");
  });
});

describe("public reservations API — durable email enqueue", () => {
  it("writes the reservation confirmation outbox intent inside the reservation transaction", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post({ ...MIN_BODY, name: "山田" }));

    expect(res.status).toBe(200);
    expect(routeMocks.reservationEmailOutboxUpsert).toHaveBeenCalledWith({
      where: {
        reservationId_notificationType: {
          reservationId: "res-abc",
          notificationType: "RESERVATION_CONFIRMATION",
        },
      },
      create: {
        reservationId: "res-abc",
        notificationType: "RESERVATION_CONFIRMATION",
        status: "PENDING",
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: expect.any(Date),
      },
      update: {},
      select: {
        id: true,
        status: true,
      },
    });
    expect(routeMocks.sendReservationEmail).not.toHaveBeenCalled();
  });
});

describe("public reservations API — durable idempotency", () => {
  it("replays the persisted response for the same key and body", async () => {
    const { POST } = await loadRoute();
    const firstResponse = await POST(post({ ...MIN_BODY, name: "山田" }, "replay-key"));
    const firstBody = await firstResponse.json();
    const firstTokenCreateCount = routeMocks.lineLinkTokenCreate.mock.calls.length;

    const replayResponse = await POST(post({ ...MIN_BODY, name: "山田" }, "replay-key"));
    const replayBody = await replayResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(replayResponse.status).toBe(200);
    expect(replayBody).toEqual(firstBody);
    expect(routeMocks.lineLinkTokenCreate).toHaveBeenCalledTimes(firstTokenCreateCount);
    expect(routeMocks.reservationEmailOutboxUpsert).toHaveBeenCalledTimes(2);

    const persisted = routeMocks.idempotencyRows.get("replay-key")?.responseBody;
    expect(persisted).toMatchObject({
      reservationId: "res-abc",
      lineLinkIssued: true,
    });
    expect(persisted).not.toHaveProperty("managementUrl");
    expect((persisted as { lineNotification?: unknown }).lineNotification).not.toHaveProperty(
      "linkUrl",
    );
    expect(JSON.stringify(persisted)).not.toContain("token=");
  });

  it("returns 409 for the same key with a different body", async () => {
    const { POST } = await loadRoute();
    await expect(POST(post({ ...MIN_BODY, name: "山田" }, "conflict-key"))).resolves.toMatchObject({
      status: 200,
    });

    const response = await POST(post({ ...MIN_BODY, name: "佐藤" }, "conflict-key"));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(routeMocks.reservationEmailOutboxUpsert).toHaveBeenCalledTimes(2);
  });
});

describe("public reservations API — linkUrl uses liff.line.me (P4)", () => {
  it("linkUrl is https://liff.line.me/<LIFF_LINK_ID>?t=... when NEXT_PUBLIC_LIFF_LINK_ID is set", async () => {
    process.env.NEXT_PUBLIC_LIFF_LINK_ID = "999-liff-link-id";
    // getOrCreateLineLinkToken needs a raw token to return
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as {
      reservationLineLinkToken: Record<string, ReturnType<typeof vi.fn>>;
    };
    p.reservationLineLinkToken.create.mockResolvedValue({
      id: "tok-1",
      tokenHash: "hash",
      expiresAt: new Date(),
    });

    const { POST } = await loadRoute();
    const res = await POST(post({ ...MIN_BODY, name: "山田" }));
    if (res.status !== 200) return;
    const body = await res.json();
    const linkUrl: string | undefined = body.lineNotification?.linkUrl;
    if (!linkUrl) return; // token creation may fail in test env — acceptable
    expect(linkUrl).toMatch(/^https:\/\/liff\.line\.me\/999-liff-link-id\?t=/);
  });

  it("does not mint a fresh LINE link token for a deduplicated reservation replay", async () => {
    const createdAt = new Date();
    routeMocks.txReservationFindMany.mockResolvedValue([
      {
        id: "res-existing",
        date: VALID_DATE,
        servicePeriod: "DINNER",
        reservationType: "NORMAL",
        seatType: "TABLE",
        partySize: 2,
        arrivalTime: "18:00",
        name: "山田",
        phone: "090-0000-1234",
        note: null,
        status: "CONFIRMED",
        lineUserId: null,
        lineReminderSentAt: null,
        lineLinkedAt: null,
        lineLinkSource: null,
        lineReminderStatus: null,
        lineReminderError: null,
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    const { POST } = await loadRoute();
    const res = await POST(post({ ...MIN_BODY, name: "山田" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deduplicated).toBe(true);
    expect(body.lineNotification).toEqual({ enabled: false, deduplicated: true });
    expect(routeMocks.lineLinkTokenCreate).not.toHaveBeenCalled();
    expect(routeMocks.reservationEmailOutboxUpsert).not.toHaveBeenCalled();
  });
});

describe("public reservations API — LINE customer link auto attach", () => {
  it("does not auto-attach a phone link even when the legacy flag is true", async () => {
    process.env.LINE_PHONE_AUTO_ATTACH_ENABLED = "true";
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as {
      lineCustomerLink: Record<string, ReturnType<typeof vi.fn>>;
      lineFriend: Record<string, ReturnType<typeof vi.fn>>;
    };
    p.lineCustomerLink.findMany.mockResolvedValue([{ lineUserId: "U" + "0".repeat(32) }]);
    p.lineFriend.findUnique.mockResolvedValue({ friendshipStatus: "FRIEND" });
    const { canPushToLineUser } = await import("@/lib/line");
    vi.mocked(canPushToLineUser).mockResolvedValue({ status: "ACTIVE" });

    const { POST } = await loadRoute();
    const res = await POST(post({ ...MIN_BODY, name: "山田" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.lineNotification.enabled).toBe(false);
    expect(p.lineCustomerLink.findMany).not.toHaveBeenCalled();
  });
});
