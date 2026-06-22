import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.env = { ...originalEnv };
});

function setBaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
}

async function loadLine() {
  vi.resetModules();
  setBaseEnv();
  return import("@/lib/line");
}

describe("generateLineLinkToken", () => {
  it("returns a URL-safe base64 string of ~43 characters (256 bits)", async () => {
    const { generateLineLinkToken } = await loadLine();
    const token = generateLineLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it("returns unique tokens on each call", async () => {
    const { generateLineLinkToken } = await loadLine();
    const a = generateLineLinkToken();
    const b = generateLineLinkToken();
    expect(a).not.toBe(b);
  });
});

describe("hashLineLinkToken", () => {
  beforeEach(() => {
    process.env.LINE_LINK_TOKEN_PEPPER = "test-pepper-abc";
  });

  it("returns a hex SHA-256 hash", async () => {
    const { hashLineLinkToken } = await loadLine();
    const hash = hashLineLinkToken("myrawtoken");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", async () => {
    const { hashLineLinkToken } = await loadLine();
    expect(hashLineLinkToken("tok")).toBe(hashLineLinkToken("tok"));
  });

  it("differs for different tokens", async () => {
    const { hashLineLinkToken } = await loadLine();
    expect(hashLineLinkToken("tok-a")).not.toBe(hashLineLinkToken("tok-b"));
  });

  it("does not reveal the raw token in the output", async () => {
    const { hashLineLinkToken } = await loadLine();
    const rawToken = "secret-raw-token-value";
    const hash = hashLineLinkToken(rawToken);
    expect(hash).not.toContain(rawToken);
  });

  it("throws in production when pepper is absent", async () => {
    // Set all required production env vars to pass env.ts validation.
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
    process.env.DATABASE_URL = "postgresql://test";
    process.env.ADMIN_BASIC_USER = "admin";
    process.env.ADMIN_BASIC_PASS = "pass";
    process.env.CRON_SECRET = "secret";
    process.env.BACKUP_EXPORT_SECRET = "backup-secret";
    process.env.RATE_LIMIT_HASH_SECRET = "rate-limit-hash-secret-32chars-min";
    process.env.BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY = "key-32-chars-xxxxxxxxxxxxxxxxxxxx";
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.LINE_LINK_TOKEN_PEPPER;
    const { hashLineLinkToken } = await import("@/lib/line");
    expect(() => hashLineLinkToken("any")).toThrow(/LINE_LINK_TOKEN_PEPPER/);
  });

  it("uses dev fallback when pepper absent in non-production", async () => {
    vi.resetModules();
    setBaseEnv();
    delete process.env.LINE_LINK_TOKEN_PEPPER;
    // NODE_ENV is "test" by default in vitest
    const { hashLineLinkToken } = await import("@/lib/line");
    const hash = hashLineLinkToken("tok");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalizeReservationPhone", () => {
  it("strips hyphens and spaces", async () => {
    const { normalizeReservationPhone } = await loadLine();
    expect(normalizeReservationPhone("090-1234-5678")).toBe("09012345678");
    expect(normalizeReservationPhone("090 1234 5678")).toBe("09012345678");
  });

  it("converts full-width digits to ASCII", async () => {
    const { normalizeReservationPhone } = await loadLine();
    expect(normalizeReservationPhone("０９０－１２３４－５６７８")).toBe("09012345678");
  });

  it("strips parentheses and dots", async () => {
    const { normalizeReservationPhone } = await loadLine();
    expect(normalizeReservationPhone("(090)1234-5678")).toBe("09012345678");
    expect(normalizeReservationPhone("090.1234.5678")).toBe("09012345678");
  });
});

describe("getPhoneLast4", () => {
  it("returns the last 4 digits of a normalized phone", async () => {
    const { getPhoneLast4 } = await loadLine();
    expect(getPhoneLast4("090-1234-5678")).toBe("5678");
    expect(getPhoneLast4("０９０－１２３４－５６７８")).toBe("5678");
  });
});

describe("canPushToLineUser classified result", () => {
  const VALID_UID = "U" + "0".repeat(32);

  function mockFetchStatus(status: number) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({}),
        text: async () => "",
        headers: new Headers(),
      })
    );
  }

  it("returns ACTIVE on HTTP 200", async () => {
    vi.resetModules();
    setBaseEnv();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok";
    mockFetchStatus(200);
    const { canPushToLineUser } = await import("@/lib/line");
    const result = await canPushToLineUser(VALID_UID);
    expect(result.status).toBe("ACTIVE");
  });

  it("returns BLOCKED on HTTP 404", async () => {
    vi.resetModules();
    setBaseEnv();
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "tok";
    mockFetchStatus(404);
    const { canPushToLineUser } = await import("@/lib/line");
    const result = await canPushToLineUser(VALID_UID);
    expect(result.status).toBe("BLOCKED");
  });

  it("returns BLOCKED for invalid lineUserId format", async () => {
    const { canPushToLineUser } = await loadLine();
    const result = await canPushToLineUser("not-a-valid-id");
    expect(result.status).toBe("BLOCKED");
  });

  it("returns PENDING_CHECK when messaging env not configured", async () => {
    vi.resetModules();
    setBaseEnv();
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const { canPushToLineUser } = await import("@/lib/line");
    const result = await canPushToLineUser(VALID_UID);
    expect(result.status).toBe("PENDING_CHECK");
  });
});
