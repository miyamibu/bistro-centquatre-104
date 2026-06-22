import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  vi.unstubAllEnvs();
});

async function loadRequestMeta() {
  vi.resetModules();
  return import("@/lib/request-meta");
}

describe("request metadata hashing", () => {
  it("uses deterministic purpose-separated HMAC hashes", async () => {
    process.env.RATE_LIMIT_HASH_SECRET = "test-rate-limit-hash-secret-32chars";
    const { hashText } = await loadRequestMeta();

    expect(hashText("127.0.0.1", "rate-limit-ip")).toBe(
      hashText("127.0.0.1", "rate-limit-ip")
    );
    expect(hashText("127.0.0.1", "rate-limit-ip")).not.toBe(
      hashText("127.0.0.1", "audit-ip")
    );
    expect(hashText("127.0.0.1", "rate-limit-ip")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the secret changes and does not include raw IP", async () => {
    process.env.RATE_LIMIT_HASH_SECRET = "test-rate-limit-hash-secret-32chars-A";
    const { hashClientIp } = await loadRequestMeta();
    const left = hashClientIp("203.0.113.10");

    process.env.RATE_LIMIT_HASH_SECRET = "test-rate-limit-hash-secret-32chars-B";
    const right = hashClientIp("203.0.113.10");

    expect(left).not.toBe(right);
    expect(left).not.toContain("203.0.113.10");
    expect(right).not.toContain("203.0.113.10");
  });

  it("fails closed in production when RATE_LIMIT_HASH_SECRET is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.RATE_LIMIT_HASH_SECRET;
    const { hashClientIp } = await loadRequestMeta();

    expect(() => hashClientIp("203.0.113.10")).toThrow(/RATE_LIMIT_HASH_SECRET/);
  });
});
