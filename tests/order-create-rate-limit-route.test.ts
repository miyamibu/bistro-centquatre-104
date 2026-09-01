import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceScopedRateLimit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/reservation-rate-limit", () => ({
  enforceScopedRateLimit: mocks.enforceScopedRateLimit,
}));
vi.mock("@/lib/order-actions", () => ({
  buildIdempotencyHash: vi.fn(),
  createQuotedHoldExpiry: vi.fn(),
  executeAtomicOrderMutation: vi.fn(),
  hashHumanToken: vi.fn(),
  normalizeOrderPaymentMethod: vi.fn(),
}));

function buildRequest() {
  return new NextRequest("http://localhost:3000/api/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "order-rate-limit-test",
      origin: "http://localhost:3000",
      "x-forwarded-for": "203.0.113.42",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify({
      items: [{ id: "apron", quantity: 1 }],
      customerInfo: {
        name: "監査 カナリア",
        email: "test@example.com",
        phone: "09000000000",
        zipCode: "100-0001",
        prefecture: "東京都",
        city: "千代田区",
        address: "1-1-1",
      },
      paymentMethod: "BANK_TRANSFER",
      total: 10000,
    }),
  });
}

beforeEach(() => {
  mocks.enforceScopedRateLimit.mockReset();
});

describe("POST /api/orders rate limiting", () => {
  it("returns 429 with a retry window when the limit is exceeded", async () => {
    mocks.enforceScopedRateLimit.mockResolvedValue(false);
    const { POST } = await import("@/app/api/orders/route");

    const response = await POST(buildRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    await expect(response.json()).resolves.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("fails closed when the durable limiter is unavailable", async () => {
    mocks.enforceScopedRateLimit.mockRejectedValue(new Error("database unavailable"));
    const { POST } = await import("@/app/api/orders/route");

    const response = await POST(buildRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "RATE_LIMIT_CHECK_FAILED" });
  });
});
