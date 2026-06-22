import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const VALID_UID = "U" + "0".repeat(32);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        lineFriend: {
          upsert: vi.fn().mockResolvedValue({}),
        },
        lineCustomerLink: {
          upsert: vi.fn().mockResolvedValue({}),
        },
      })
    ),
    reservationRateLimitEvent: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
    lineCustomerLink: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

vi.mock("@/lib/line", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    verifyLineIdToken: vi.fn().mockResolvedValue(VALID_UID),
    canPushToLineUser: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
    normalizeReservationPhone: vi.fn((p: string) => p.replace(/\D/g, "")),
    hashNormalizedPhone: vi.fn().mockReturnValue("hashed-phone"),
  };
});

const savedEnv = { ...process.env };

beforeEach(async () => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.LINE_LOGIN_CHANNEL_ID = "channel-A";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok";
  process.env.LINE_LINK_TOKEN_PEPPER = "test-pepper";
  process.env.LINE_PHONE_AUTO_ATTACH_ENABLED = "true";
  vi.resetAllMocks();

  const { prisma } = await import("@/lib/prisma");
  const p = prisma as unknown as Record<string, ReturnType<typeof vi.fn> | Record<string, ReturnType<typeof vi.fn>>>;
  (p.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (p.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      lineFriend: { upsert: vi.fn().mockResolvedValue({}) },
      lineCustomerLink: { upsert: vi.fn().mockResolvedValue({}) },
    })
  );
  (p.reservationRateLimitEvent as Record<string, ReturnType<typeof vi.fn>>).count.mockResolvedValue(0);
  (p.reservationRateLimitEvent as Record<string, ReturnType<typeof vi.fn>>).create.mockResolvedValue({});
  (p.lineCustomerLink as Record<string, ReturnType<typeof vi.fn>>).updateMany.mockResolvedValue({ count: 1 });

  const { verifyLineIdToken, canPushToLineUser, normalizeReservationPhone, hashNormalizedPhone } =
    await import("@/lib/line");
  vi.mocked(verifyLineIdToken).mockResolvedValue(VALID_UID);
  vi.mocked(canPushToLineUser).mockResolvedValue({ status: "ACTIVE" });
  vi.mocked(normalizeReservationPhone).mockImplementation((p: string) => p.replace(/\D/g, ""));
  vi.mocked(hashNormalizedPhone).mockReturnValue("hashed-phone");
});

afterEach(() => {
  process.env = { ...savedEnv };
});

function post(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/line/customer-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  return import("@/app/api/line/customer-link/route");
}

describe("/api/line/customer-link", () => {
  it("is disabled unless phone auto attach is explicitly enabled", async () => {
    process.env.LINE_PHONE_AUTO_ATTACH_ENABLED = "false";
    const { prisma } = await import("@/lib/prisma");
    const transaction = prisma.$transaction as ReturnType<typeof vi.fn>;

    const { POST } = await loadRoute();
    const res = await POST(post({ phone: "090-1234-5678", lineIdToken: "id.tok" }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("LINE_CUSTOMER_LINK_DISABLED");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("registers a verified LINE user and hashed phone for future reservations", async () => {
    const { prisma } = await import("@/lib/prisma");
    const transaction = prisma.$transaction as ReturnType<typeof vi.fn>;
    const lineFriendUpsert = vi.fn().mockResolvedValue({});
    const lineCustomerLinkUpsert = vi.fn().mockResolvedValue({});
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        lineFriend: { upsert: lineFriendUpsert },
        lineCustomerLink: { upsert: lineCustomerLinkUpsert },
      })
    );

    const { POST } = await loadRoute();
    const res = await POST(post({ phone: "090-1234-5678", lineIdToken: "id.tok" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(lineFriendUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lineUserId: VALID_UID } })
    );
    expect(lineCustomerLinkUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          lineUserId_normalizedPhoneHash: {
            lineUserId: VALID_UID,
            normalizedPhoneHash: "hashed-phone",
          },
        },
      })
    );
  });

  it("rejects invalid LINE ID tokens without storing a phone link", async () => {
    const { verifyLineIdToken } = await import("@/lib/line");
    vi.mocked(verifyLineIdToken).mockResolvedValue(null);

    const { prisma } = await import("@/lib/prisma");
    const transaction = prisma.$transaction as ReturnType<typeof vi.fn>;

    const { POST } = await loadRoute();
    const res = await POST(post({ phone: "090-1234-5678", lineIdToken: "bad" }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe("LINE_ID_TOKEN_INVALID");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not register when the LINE user cannot receive push messages", async () => {
    const { canPushToLineUser } = await import("@/lib/line");
    vi.mocked(canPushToLineUser).mockResolvedValue({ status: "BLOCKED" });

    const { prisma } = await import("@/lib/prisma");
    const transaction = prisma.$transaction as ReturnType<typeof vi.fn>;

    const { POST } = await loadRoute();
    const res = await POST(post({ phone: "090-1234-5678", lineIdToken: "id.tok" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("LINE_FRIEND_REQUIRED");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("revokes an active phone link for the verified LINE user", async () => {
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as {
      lineCustomerLink: Record<string, ReturnType<typeof vi.fn>>;
    };

    const { DELETE } = await loadRoute();
    const res = await DELETE(post({ phone: "090-1234-5678", lineIdToken: "id.tok" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.lineNotification.enabled).toBe(false);
    expect(p.lineCustomerLink.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          lineUserId: VALID_UID,
          normalizedPhoneHash: "hashed-phone",
          status: "ACTIVE",
        },
        data: expect.objectContaining({ status: "REVOKED" }),
      })
    );
  });
});
