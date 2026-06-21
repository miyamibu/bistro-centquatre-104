import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

describe("idempotency helpers", () => {
  it("validates key presence, length, and safe characters", async () => {
    const { validateIdempotencyKey } = await import("@/lib/idempotency");

    expect(validateIdempotencyKey("")).toEqual({
      ok: false,
      code: "MISSING_IDEMPOTENCY_KEY",
    });
    expect(validateIdempotencyKey("short")).toEqual({
      ok: false,
      code: "INVALID_IDEMPOTENCY_KEY",
    });
    expect(validateIdempotencyKey("invalid key with spaces")).toEqual({
      ok: false,
      code: "INVALID_IDEMPOTENCY_KEY",
    });
    expect(validateIdempotencyKey("order_2026-06-22:abcdef")).toEqual({
      ok: true,
      key: "order_2026-06-22:abcdef",
    });
  });

  it("builds purpose-separated HMAC actor keys without embedding PII", async () => {
    process.env = {
      ...originalEnv,
      IDEMPOTENCY_HASH_SECRET: "test-idempotency-secret",
    };
    const { buildHmacActorKey } = await import("@/lib/idempotency");

    const key = buildHmacActorKey("order-create", ["guest@example.com", "09012345678"]);

    expect(key).toMatch(/^order-create:[0-9a-f]{64}$/);
    expect(key).not.toContain("guest@example.com");
    expect(key).not.toContain("09012345678");
    expect(buildHmacActorKey("order-action", ["guest@example.com", "09012345678"])).not.toBe(key);
  });
});
