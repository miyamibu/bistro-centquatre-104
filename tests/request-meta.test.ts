import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
  it("prefers the trusted Netlify client IP and never trusts the XFF left edge", async () => {
    const { getClientIp } = await loadRequestMeta();
    const request = new NextRequest("https://example.test", {
      headers: {
        "x-nf-client-connection-ip": "203.0.113.20",
        "x-real-ip": "203.0.113.21",
        "x-forwarded-for": "198.51.100.1, 198.51.100.2",
      },
    });

    expect(getClientIp(request)).toBe("203.0.113.20");

    const fallback = new NextRequest("https://example.test", {
      headers: { "x-forwarded-for": "198.51.100.1, 198.51.100.2" },
    });
    expect(getClientIp(fallback)).toBe("198.51.100.2");
  });

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
