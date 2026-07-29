import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseBasicAuthHeader } from "@/lib/basic-auth";
import { middleware } from "@/middleware";
import { GET as getAdminBusinessDays } from "@/app/api/admin/business-days/route";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

async function loadMiddlewareWithAdminEnv(nodeEnv: "development" | "test" | "production") {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    NODE_ENV: nodeEnv,
    ADMIN_BASIC_USER: "admin",
    ADMIN_BASIC_PASS: "password",
  };
  const middlewareModule = await import("@/middleware");
  return middlewareModule.middleware;
}

describe("Basic auth hardening", () => {
  it("treats malformed base64 credentials as null instead of throwing", () => {
    expect(parseBasicAuthHeader("Basic A===")).toBeNull();
    expect(parseBasicAuthHeader("Basic Zm9v")).toBeNull();
  });

  it("returns 401 from middleware for malformed Basic header", () => {
    const request = new NextRequest("http://localhost:3000/admin/reservations", {
      headers: {
        authorization: "Basic A===",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Authorization");
  });

  it("lets backup export API use its route-level token auth", () => {
    const request = new NextRequest(
      "http://localhost:3000/api/admin/backups/reservations/export?date=2026-04-21",
      {
        headers: {
          accept: "application/json",
          "x-backup-export-secret": "backup-export-secret",
        },
      }
    );

    const response = middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("keeps /admin/daily-journal Basic-auth protected in development", async () => {
    const developmentMiddleware = await loadMiddlewareWithAdminEnv("development");
    const request = new NextRequest("http://localhost:3000/admin/daily-journal");

    const response = developmentMiddleware(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("allows /admin/daily-journal in development only with valid Basic auth", async () => {
    const developmentMiddleware = await loadMiddlewareWithAdminEnv("development");
    const request = new NextRequest("http://localhost:3000/admin/daily-journal", {
      headers: {
        authorization: `Basic ${Buffer.from("admin:password").toString("base64")}`,
      },
    });

    const response = developmentMiddleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("returns 401 from admin route for malformed Basic header", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/business-days", {
      headers: {
        authorization: "Basic A===",
      },
    });

    const response = await getAdminBusinessDays(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
