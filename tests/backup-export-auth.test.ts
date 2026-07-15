import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
            source: "ADMIN_SHARED_BASIC",
            actorName: "admin",
            requestId: "audit-request-id",
            ipAddress: null,
            userAgent: null,
            note: null,
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
          },
        ]),
      },
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

  it("rejects Basic auth at the route before any backup data access", async () => {
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
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: 1,
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
      checksumSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      requestId: "test-request-id",
    });
  });
});
