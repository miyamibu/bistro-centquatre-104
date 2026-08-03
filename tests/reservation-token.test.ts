import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

describe("reservation-scoped bearer token derivation", () => {
  it("is deterministic and purpose-separated", async () => {
    process.env.RESERVATION_TOKEN_SECRET = "r".repeat(32);
    const { deriveReservationScopedToken } = await import("@/lib/reservation-token");

    const first = deriveReservationScopedToken("management", "reservation-1", "request-1");
    const replay = deriveReservationScopedToken("management", "reservation-1", "request-1");
    const lineLink = deriveReservationScopedToken("line-link", "reservation-1", "request-1");

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(replay).toBe(first);
    expect(lineLink).not.toBe(first);
  });

  it("fails closed in production when the secret is unavailable", async () => {
    process.env = { ...process.env, NODE_ENV: "production" };
    delete process.env.RESERVATION_TOKEN_SECRET;
    const { deriveReservationScopedToken } = await import("@/lib/reservation-token");

    expect(() =>
      deriveReservationScopedToken("management", "reservation-1", "request-1"),
    ).toThrow(/RESERVATION_TOKEN_SECRET/);
  });

  it("derives existing links with a retained key and new links with the active key", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      RESERVATION_TOKEN_KEYS_JSON: JSON.stringify({
        v1: "o".repeat(32),
        v2: "n".repeat(32),
      }),
      RESERVATION_TOKEN_ACTIVE_KEY_ID: "v2",
    };
    const { deriveReservationScopedToken, getActiveReservationTokenKeyId } =
      await import("@/lib/reservation-token");

    const oldToken = deriveReservationScopedToken("management", "reservation-1", "request-1", "v1");
    const newToken = deriveReservationScopedToken("management", "reservation-1", "request-1");

    expect(getActiveReservationTokenKeyId()).toBe("v2");
    expect(oldToken).not.toBe(newToken);
    expect(() => deriveReservationScopedToken("management", "reservation-1", "request-1", "missing")).toThrow(
      /not available/,
    );
  });
});
