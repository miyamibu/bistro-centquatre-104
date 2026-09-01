import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { computeReservationBackupChecksum } from "@/lib/reservation-backup-checksum.mjs";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

async function loadRoute() {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    BACKUP_EXPORT_SECRET: "backup-export-secret",
    CRON_SECRET: "cron-secret-fallback",
  };

  const routeModule = await import("@/app/api/admin/backups/reservations/export/route");
  return routeModule.GET;
}

async function loadRouteWithBackupRows() {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    BACKUP_EXPORT_SECRET: "backup-export-secret",
    CRON_SECRET: "cron-secret-fallback",
  };

  vi.doMock("@/lib/logger", () => ({
    getRequestId: () => "test-request-id",
    logError: vi.fn(),
    logInfo: vi.fn(),
  }));
  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      businessDay: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "business-day-1",
            date: "2026-04-21",
            isClosed: false,
            note: null,
          },
        ]),
      },
      privateBlockAuditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "audit-1",
            reservationId: null,
            date: "2026-04-21",
            servicePeriod: "DINNER",
            result: "CREATED",
            source: "ADMIN_USER",
            actorName: "admin",
            requestId: "audit-request-id",
            ipAddress: null,
            userAgent: null,
            note: null,
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ]),
      },
      businessDayAuditLog: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      reservationStatusAuditLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "status-audit-1",
            reservationId: "reservation-1",
            actorName: "admin",
            requestId: "status-request-id",
            ipAddress: null,
            userAgent: null,
            previousStatus: "CONFIRMED",
            nextStatus: "CANCELLED",
            reason: "test",
            createdAt: new Date("2026-04-02T00:00:00.000Z"),
          },
        ]),
      },
      reservationEmailOutbox: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "email-outbox-1",
            reservationId: "reservation-1",
            notificationType: "RESERVATION_CONFIRMATION",
            status: "PENDING",
            attempts: 0,
            maxAttempts: 5,
            nextAttemptAt: new Date("2026-04-01T00:00:00.000Z"),
            claimedAt: null,
            lockedUntil: null,
            claimToken: "must-not-be-exported",
            sentAt: null,
            lastError: null,
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
            updatedAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ]),
      },
      reservationLineLinkToken: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "link-token-1",
            reservationId: "reservation-1",
            tokenHash: "hash-only",
            expiresAt: new Date("2026-04-30T00:00:00.000Z"),
            usedAt: null,
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ]),
      },
      reservationManagementToken: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "management-token-1",
            reservationId: "reservation-1",
            tokenHash: "management-hash-only",
            keyId: "v1",
            expiresAt: new Date("2026-05-21T00:00:00.000Z"),
            revokedAt: null,
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ]),
      },
      reservationIdempotency: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "idempotency-1",
            idempotencyKey: "public-idempotency-key",
            requestHash: "request-hash",
            responseStatus: 200,
            responseBody: { reservationId: "reservation-1", managementTokenIssued: true },
            reservationId: "reservation-1",
            tokenKeyId: "v1",
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
            updatedAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ]),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "notification-event-1",
            reservationId: "reservation-1",
            channel: "LINE",
            type: "DAY_BEFORE_REMINDER",
            targetDate: "2026-04-21",
            status: "SENT",
            retryKey: "retry-key-1",
            claimedAt: new Date("2026-04-20T00:00:00.000Z"),
            sentAt: new Date("2026-04-20T00:00:01.000Z"),
            error: null,
            createdAt: new Date("2026-04-19T00:00:00.000Z"),
            updatedAt: new Date("2026-04-20T00:00:01.000Z"),
          },
        ]),
      },
      reservationCorrectionAuditLog: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn().mockImplementation(async (callback) =>
        callback({
          $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
          $queryRaw: vi.fn().mockResolvedValue([{ count: 0 }]),
          $executeRaw: vi.fn().mockResolvedValue(undefined),
        }),
      ),
    },
  }));
  vi.doMock("@/lib/reservation-compat", async () => {
    const actual = await vi.importActual<typeof import("@/lib/reservation-compat")>(
      "@/lib/reservation-compat"
    );
    return {
      ...actual,
      ensureReservationSchemaReady: vi.fn().mockResolvedValue(undefined),
      findReservationsCompat: vi.fn().mockResolvedValue([
        {
          id: "reservation-1",
          date: "2026-04-21",
          servicePeriod: "DINNER",
          reservationType: "NORMAL",
          seatType: "MAIN",
          partySize: 2,
          arrivalTime: "18:00",
          name: "テスト予約",
          phone: "000-0000-0000",
          note: null,
          status: "CONFIRMED",
          lineUserId: null,
          createdAt: new Date("2026-04-01T00:00:00.000Z"),
          updatedAt: new Date("2026-04-01T00:00:00.000Z"),
        },
      ]),
    };
  });

  const routeModule = await import("@/app/api/admin/backups/reservations/export/route");
  return routeModule.GET;
}

async function loadRouteWithDataAccessSpies() {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    BACKUP_EXPORT_SECRET: "backup-export-secret",
    CRON_SECRET: "cron-secret-fallback",
  };

  const ensureReservationSchemaReady = vi.fn().mockResolvedValue(undefined);
  const findReservationsCompat = vi.fn().mockResolvedValue([]);
  const businessDayFindMany = vi.fn().mockResolvedValue([]);
  const privateBlockAuditFindMany = vi.fn().mockResolvedValue([]);

  vi.doMock("@/lib/logger", () => ({
    getRequestId: () => "test-request-id",
    logError: vi.fn(),
    logInfo: vi.fn(),
  }));
  vi.doMock("@/lib/prisma", () => ({
      prisma: {
      businessDay: {
        findMany: businessDayFindMany,
      },
        privateBlockAuditLog: {
          findMany: privateBlockAuditFindMany,
        },
        $transaction: vi.fn().mockImplementation(async (callback) =>
          callback({
            $executeRawUnsafe: vi.fn().mockResolvedValue(undefined),
            $queryRaw: vi.fn().mockResolvedValue([{ count: 0 }]),
            $executeRaw: vi.fn().mockResolvedValue(undefined),
          }),
        ),
      },
  }));
  vi.doMock("@/lib/reservation-compat", async () => {
    const actual = await vi.importActual<typeof import("@/lib/reservation-compat")>(
      "@/lib/reservation-compat"
    );
    return {
      ...actual,
      ensureReservationSchemaReady,
      findReservationsCompat,
    };
  });

  const routeModule = await import("@/app/api/admin/backups/reservations/export/route");
  return {
    GET: routeModule.GET,
    businessDayFindMany,
    ensureReservationSchemaReady,
    findReservationsCompat,
    privateBlockAuditFindMany,
  };
}

describe("backup export auth boundary", () => {
  it("rejects missing authorization header", async () => {
    const GET = await loadRoute();
    const request = new NextRequest(
      "http://localhost:3000/api/admin/backups/reservations/export?date=2026-04-21",
      {
        method: "GET",
      }
    );

    const response = await GET(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects invalid bearer token", async () => {
    const GET = await loadRoute();
    const request = new NextRequest(
      "http://localhost:3000/api/admin/backups/reservations/export?date=2026-04-21",
      {
        method: "GET",
        headers: {
          authorization: "Bearer invalid-token",
        },
      }
    );

    const response = await GET(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects CRON_SECRET when BACKUP_EXPORT_SECRET is configured separately", async () => {
    const GET = await loadRoute();
    const request = new NextRequest(
      "http://localhost:3000/api/admin/backups/reservations/export?date=2026-04-21",
      {
        method: "GET",
        headers: {
          authorization: "Bearer cron-secret-fallback",
        },
      }
    );

    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects legacy Basic auth at the route before any backup data access", async () => {
    const {
      GET,
      businessDayFindMany,
      ensureReservationSchemaReady,
      findReservationsCompat,
      privateBlockAuditFindMany,
    } = await loadRouteWithDataAccessSpies();
    const request = new NextRequest(
      "http://localhost:3000/api/admin/backups/reservations/export?date=2026-04-21",
      {
        method: "GET",
        headers: {
          authorization: `Basic ${Buffer.from("admin:password").toString("base64")}`,
        },
      }
    );

    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
    expect(ensureReservationSchemaReady).not.toHaveBeenCalled();
    expect(businessDayFindMany).not.toHaveBeenCalled();
    expect(findReservationsCompat).not.toHaveBeenCalled();
    expect(privateBlockAuditFindMany).not.toHaveBeenCalled();
  });

  it("accepts x-backup-export-secret header for auth", async () => {
    const GET = await loadRoute();
    const request = new NextRequest(
      "http://localhost:3000/api/admin/backups/reservations/export?date=invalid",
      {
        method: "GET",
        headers: {
          "x-backup-export-secret": "backup-export-secret",
        },
      }
    );

    const response = await GET(request);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("returns backup JSON for a valid token and date range", async () => {
    const GET = await loadRouteWithBackupRows();
    const request = new NextRequest(
      "http://localhost:3000/api/admin/backups/reservations/export?from=2026-04-21&to=2026-04-21",
      {
        method: "GET",
        headers: {
          "x-backup-export-secret": "backup-export-secret",
        },
      }
    );

    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      schemaVersion: 4,
      range: {
        from: "2026-04-21",
        to: "2026-04-21",
        days: 1,
      },
      counts: {
        businessDays: 1,
        reservations: 1,
        privateBlockAuditLogs: 1,
      },
      reservations: [
        {
          id: "reservation-1",
          lineUserId: null,
        },
      ],
      reservationStatusAuditLogs: [{ id: "status-audit-1" }],
      reservationEmailOutbox: [{ id: "email-outbox-1" }],
      reservationLineLinkTokens: [{ id: "link-token-1", tokenHash: "hash-only" }],
      reservationManagementTokens: [
        { id: "management-token-1", tokenHash: "management-hash-only" },
      ],
      reservationIdempotencyRecords: [
        { id: "idempotency-1", reservationId: "reservation-1" },
      ],
      notificationEvents: [{ id: "notification-event-1" }],
      checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      requestId: "test-request-id",
    });

    expect(body.reservationEmailOutbox[0]).not.toHaveProperty("claimToken");
    expect(body.checksumSha256).toBe(computeReservationBackupChecksum(body));
  });
});
