import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationStatus, ReservationType } from "@prisma/client";
import { hashReservationManagementToken } from "@/lib/reservation-management-token";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  schemaReady: vi.fn(),
  tokenFindUnique: vi.fn(),
  tokenUpdateMany: vi.fn(),
  reservationUpdateMany: vi.fn(),
  reservationFindUnique: vi.fn(),
  auditCreate: vi.fn(),
  emailOutboxUpdateMany: vi.fn(),
  emailOutboxUpsert: vi.fn(),
  rateLimitCount: vi.fn(),
  rateLimitCreate: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

const originalEnv = { ...process.env };
const rawToken = "a".repeat(43);

const txClient = {
  reservationManagementToken: {
    findUnique: mocks.tokenFindUnique,
    updateMany: mocks.tokenUpdateMany,
  },
  reservation: {
    updateMany: mocks.reservationUpdateMany,
    findUnique: mocks.reservationFindUnique,
  },
  reservationStatusAuditLog: {
    create: mocks.auditCreate,
  },
  reservationEmailOutbox: {
    updateMany: mocks.emailOutboxUpdateMany,
    upsert: mocks.emailOutboxUpsert,
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    reservationRateLimitEvent: {
      count: mocks.rateLimitCount,
      create: mocks.rateLimitCreate,
    },
  },
}));

vi.mock("@/lib/reservation-compat", () => ({
  RESERVATION_SCHEMA_NOT_READY_CODE: "RESERVATION_SCHEMA_NOT_READY",
  ensureReservationSchemaReady: mocks.schemaReady,
  isReservationSchemaNotReadyError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/logger", () => ({
  getRequestId: vi.fn(() => "request-management-1"),
  logInfo: mocks.logInfo,
  logError: mocks.logError,
  logWarn: mocks.logWarn,
}));

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/reservations/manage", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify(body),
  });
}

function reservation(status: ReservationStatus) {
  return {
    id: "reservation-1",
    date: "2026-08-15",
    servicePeriod: "DINNER" as const,
    reservationType: ReservationType.NORMAL,
    partySize: 2,
    arrivalTime: "18:00",
    name: "山田 花子",
    customerEmail: "customer@example.com",
    note: "ディナー: 席のみ",
    status,
  };
}

function tokenRow(current: ReturnType<typeof reservation>, overrides: Record<string, unknown> = {}) {
  return {
    id: "management-token-1",
    reservationId: current.id,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    revokedAt: null,
    reservation: current,
    ...overrides,
  };
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/reservations/manage/route");
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    NODE_ENV: "test",
    RATE_LIMIT_HASH_SECRET: "test-rate-limit-hash-secret-32chars",
  };
  mocks.schemaReady.mockResolvedValue(undefined);
  mocks.rateLimitCount.mockResolvedValue(0);
  mocks.rateLimitCreate.mockResolvedValue({ id: "rate-limit-1" });
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback(txClient));
  mocks.tokenFindUnique.mockResolvedValue(tokenRow(reservation(ReservationStatus.CONFIRMED)));
  mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
  mocks.reservationUpdateMany.mockResolvedValue({ count: 1 });
  mocks.reservationFindUnique.mockResolvedValue(reservation(ReservationStatus.CANCELLED));
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.emailOutboxUpdateMany.mockResolvedValue({ count: 1 });
  mocks.emailOutboxUpsert.mockResolvedValue({ id: "customer-email-1", status: "PENDING" });
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
  vi.resetModules();
});

describe("public reservation management API", () => {
  it("looks up only the reservation bound to the token and never returns the raw token", async () => {
    const { POST } = await loadRoute();
    const response = await POST(buildRequest({ token: rawToken, action: "lookup" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reservation.id).toBe("reservation-1");
    expect(body).not.toHaveProperty("token");
    expect(mocks.tokenFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashReservationManagementToken(rawToken) } })
    );
    expect(JSON.stringify(mocks.logInfo.mock.calls)).not.toContain(rawToken);
  });

  it("rejects an invalid token format and a token bound to another reservation", async () => {
    const { POST } = await loadRoute();
    const invalidResponse = await POST(buildRequest({ token: "short", action: "lookup" }));

    expect(invalidResponse.status).toBe(400);

    const differentReservationResponse = await POST(
      buildRequest({ token: rawToken, reservationId: "reservation-2", action: "lookup" })
    );
    expect(differentReservationResponse.status).toBe(404);
    await expect(differentReservationResponse.json()).resolves.toMatchObject({
      code: "MANAGEMENT_TOKEN_INVALID",
    });
  });

  it("rejects an expired token without exposing reservation data", async () => {
    mocks.tokenFindUnique.mockResolvedValue(
      tokenRow(reservation(ReservationStatus.CONFIRMED), {
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      })
    );
    const { POST } = await loadRoute();
    const response = await POST(buildRequest({ token: rawToken, action: "lookup" }));
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.code).toBe("MANAGEMENT_TOKEN_EXPIRED");
    expect(body).not.toHaveProperty("reservation");
  });

  it("cancels CONFIRMED with CAS, audit, token revocation, and pending-email suppression", async () => {
    const { POST } = await loadRoute();
    const response = await POST(buildRequest({ token: rawToken, action: "cancel" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reservation.status).toBe(ReservationStatus.CANCELLED);
    expect(mocks.reservationUpdateMany).toHaveBeenCalledWith({
      where: { id: "reservation-1", status: ReservationStatus.CONFIRMED },
      data: {
        status: ReservationStatus.CANCELLED,
        cancelledAt: expect.any(Date),
        cancelSource: "CUSTOMER_MANAGEMENT_TOKEN",
        cancellationReason: "SELF_SERVICE",
      },
    });
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reservationId: "reservation-1",
        previousStatus: ReservationStatus.CONFIRMED,
        nextStatus: ReservationStatus.CANCELLED,
        reason: "CUSTOMER_MANAGEMENT_TOKEN",
      }),
    });
    expect(mocks.emailOutboxUpdateMany).toHaveBeenCalledWith({
      where: {
        reservationId: "reservation-1",
        notificationType: {
          in: ["RESERVATION_CONFIRMATION", "CUSTOMER_CONFIRMATION"],
        },
        status: "PENDING",
      },
      data: expect.objectContaining({
        status: "DEAD_LETTER",
        lastError: "RESERVATION_CANCELLED",
      }),
    });
    expect(mocks.tokenUpdateMany).toHaveBeenCalledWith({
      where: { reservationId: "reservation-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("treats repeated cancellation as an idempotent success", async () => {
    const { POST } = await loadRoute();
    const firstResponse = await POST(buildRequest({ token: rawToken, action: "cancel" }));
    expect(firstResponse.status).toBe(200);

    mocks.tokenFindUnique.mockResolvedValue(
      tokenRow(reservation(ReservationStatus.CANCELLED), {
        revokedAt: new Date("2026-07-31T00:00:00.000Z"),
      })
    );
    const secondResponse = await POST(buildRequest({ token: rawToken, action: "cancel" }));
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondBody.alreadyCancelled).toBe(true);
  });

  it("queues a customer confirmation resend without exposing the email address", async () => {
    const { POST } = await loadRoute();
    const response = await POST(buildRequest({ token: rawToken, action: "resend" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.customerEmailQueued).toBe(true);
    expect(body.reservation).not.toHaveProperty("customerEmail");
    expect(mocks.emailOutboxUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          reservationId_notificationType: {
            reservationId: "reservation-1",
            notificationType: "CUSTOMER_CONFIRMATION",
          },
        },
        update: expect.objectContaining({ status: "PENDING", attempts: 0 }),
      }),
    );
  });

  it("rejects a revoked token while its reservation is still active", async () => {
    mocks.tokenFindUnique.mockResolvedValue(
      tokenRow(reservation(ReservationStatus.CONFIRMED), {
        revokedAt: new Date("2026-07-31T00:00:00.000Z"),
      })
    );
    const { POST } = await loadRoute();
    const response = await POST(buildRequest({ token: rawToken, action: "lookup" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "MANAGEMENT_TOKEN_INVALID",
    });
  });

  it.each([ReservationStatus.DONE, ReservationStatus.NOSHOW])(
    "does not change %s reservations",
    async (status) => {
      mocks.tokenFindUnique.mockResolvedValue(tokenRow(reservation(status)));
      const { POST } = await loadRoute();
      const response = await POST(buildRequest({ token: rawToken, action: "cancel" }));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: "RESERVATION_NOT_CANCELLABLE",
      });
      expect(mocks.reservationUpdateMany).not.toHaveBeenCalled();
    }
  );

  it("returns a conflict when an administrator wins the CAS race", async () => {
    mocks.reservationUpdateMany.mockResolvedValue({ count: 0 });
    mocks.reservationFindUnique.mockResolvedValue(reservation(ReservationStatus.DONE));
    const { POST } = await loadRoute();
    const response = await POST(buildRequest({ token: rawToken, action: "cancel" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "RESERVATION_STATUS_CONFLICT",
    });
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
