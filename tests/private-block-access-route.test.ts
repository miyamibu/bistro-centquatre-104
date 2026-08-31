import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceScopedRateLimit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/reservation-rate-limit", () => ({
  enforceScopedRateLimit: mocks.enforceScopedRateLimit,
}));

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

beforeEach(() => {
  mocks.enforceScopedRateLimit.mockReset().mockResolvedValue(true);
});

function buildAccessRequest(accessCode: string) {
  return new NextRequest("http://localhost:3000/api/private-block/access", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ accessCode }),
  });
}

describe("private-block access route", () => {
  it("returns OK for a valid access code", async () => {
    process.env = {
      ...originalEnv,
      PRIVATE_BLOCK_ACCESS_CODE: "valid-private-block-code",
    };

    const { POST } = await import("@/app/api/private-block/access/route");
    const response = await POST(buildAccessRequest("valid-private-block-code"));

    expect(response.status).toBe(200);
  });

  it("returns 401 for an invalid access code", async () => {
    process.env = {
      ...originalEnv,
      PRIVATE_BLOCK_ACCESS_CODE: "valid-private-block-code",
    };

    const { POST } = await import("@/app/api/private-block/access/route");
    const response = await POST(buildAccessRequest("wrong-code"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe("PRIVATE_BLOCK_ACCESS_DENIED");
  });

  it("returns 503 when private-block access is not configured", async () => {
    process.env = {
      ...originalEnv,
    };
    delete process.env.PRIVATE_BLOCK_ACCESS_CODE;

    const { POST } = await import("@/app/api/private-block/access/route");
    const response = await POST(buildAccessRequest("any-code"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("PRIVATE_BLOCK_ACCESS_NOT_CONFIGURED");
  });

  it("returns 429 when access-code attempts exceed the limit", async () => {
    process.env = {
      ...originalEnv,
      PRIVATE_BLOCK_ACCESS_CODE: "valid-private-block-code",
    };
    mocks.enforceScopedRateLimit.mockResolvedValue(false);

    const { POST } = await import("@/app/api/private-block/access/route");
    const response = await POST(buildAccessRequest("wrong-code"));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("fails closed when the access-code rate limit cannot be checked", async () => {
    process.env = {
      ...originalEnv,
      PRIVATE_BLOCK_ACCESS_CODE: "valid-private-block-code",
    };
    mocks.enforceScopedRateLimit.mockRejectedValue(new Error("database unavailable"));

    const { POST } = await import("@/app/api/private-block/access/route");
    const response = await POST(buildAccessRequest("valid-private-block-code"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "RATE_LIMIT_CHECK_FAILED" });
  });
});
