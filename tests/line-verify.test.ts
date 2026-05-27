import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_SUB = "U" + "0".repeat(32);

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

async function loadLine() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.LINE_LOGIN_CHANNEL_ID = "channel-A";
  return import("@/lib/line");
}

function mockFetchOnce(payload: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    headers: new Headers(),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("verifyLineIdToken", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("returns sub when iss, aud, and sub format are valid", async () => {
    const fetchMock = mockFetchOnce({
      iss: "https://access.line.me",
      aud: "channel-A",
      sub: VALID_SUB,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const { verifyLineIdToken } = await loadLine();
    const result = await verifyLineIdToken("dummy.id.token");
    expect(result).toBe(VALID_SUB);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.line.me/oauth2/v2.1/verify");
    expect(init.method).toBe("POST");
    // The token should be sent only via form-urlencoded body, not in headers/logs.
    expect(String(init.body)).toContain("id_token=dummy.id.token");
    expect(String(init.body)).toContain("client_id=channel-A");
  });

  it("returns null when aud does not match LINE_LOGIN_CHANNEL_ID", async () => {
    mockFetchOnce({
      iss: "https://access.line.me",
      aud: "different-channel",
      sub: VALID_SUB,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const { verifyLineIdToken } = await loadLine();
    const result = await verifyLineIdToken("dummy");
    expect(result).toBeNull();
  });

  it("returns null when iss is wrong", async () => {
    mockFetchOnce({
      iss: "https://evil.example.com",
      aud: "channel-A",
      sub: VALID_SUB,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const { verifyLineIdToken } = await loadLine();
    const result = await verifyLineIdToken("dummy");
    expect(result).toBeNull();
  });

  it("returns null when sub format is invalid", async () => {
    mockFetchOnce({
      iss: "https://access.line.me",
      aud: "channel-A",
      sub: "not-a-valid-sub",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const { verifyLineIdToken } = await loadLine();
    const result = await verifyLineIdToken("dummy");
    expect(result).toBeNull();
  });

  it("returns null when exp is in the past", async () => {
    mockFetchOnce({
      iss: "https://access.line.me",
      aud: "channel-A",
      sub: VALID_SUB,
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const { verifyLineIdToken } = await loadLine();
    const result = await verifyLineIdToken("dummy");
    expect(result).toBeNull();
  });

  it("does not leak the token into console output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetchOnce({
      iss: "https://access.line.me",
      aud: "channel-A",
      sub: VALID_SUB,
    });
    const { verifyLineIdToken } = await loadLine();
    await verifyLineIdToken("secret-token-do-not-log");
    const allOutput = [
      ...consoleSpy.mock.calls,
      ...errorSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join("\n");
    expect(allOutput).not.toContain("secret-token-do-not-log");
  });
});
