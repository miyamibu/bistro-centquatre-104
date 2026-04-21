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
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
