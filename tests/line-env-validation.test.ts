/**
 * P5: LINE env production validation tests.
 *
 * Global env parsing should not crash unrelated production routes when optional
 * LINE rollout env values are only partially configured.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

const BASE_PROD_ENV = {
  NODE_ENV: "production" as const,
  DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  STAFF_SESSION_MAX_AGE_SECONDS: "28800",
  CRON_SECRET: "cron-secret",
  BACKUP_EXPORT_SECRET: "backup-export-secret",
  RATE_LIMIT_HASH_SECRET: "rate-limit-hash-secret-32chars-min",
  RESERVATION_TOKEN_SECRET: "reservation-token-secret-32chars-min",
  BACKUP_ENCRYPTION_KEY: "backup-encryption-key-32-characters",
  BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: "enc-key",
};

const LINE_FULL_ENV = {
  LINE_CHANNEL_ACCESS_TOKEN: "channel-access-token",
  LINE_CHANNEL_SECRET: "channel-secret",
  LINE_LOGIN_CHANNEL_ID: "login-channel-id",
  LINE_LINK_TOKEN_PEPPER: "a".repeat(32),
  NEXT_PUBLIC_LIFF_BOOKING_ID: "123-booking-liff-id",
  NEXT_PUBLIC_LIFF_LINK_ID: "456-link-liff-id",
};

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

describe("reservation token env production validation", () => {
  it("fails closed when RESERVATION_TOKEN_SECRET is missing", async () => {
    process.env = { ...BASE_PROD_ENV };
    delete process.env.RESERVATION_TOKEN_SECRET;

    await expect(import("@/lib/env")).rejects.toThrow(/RESERVATION_TOKEN_SECRET/);
  });

  it("fails when RESERVATION_TOKEN_SECRET is too short", async () => {
    process.env = { ...BASE_PROD_ENV, RESERVATION_TOKEN_SECRET: "too-short" };

    await expect(import("@/lib/env")).rejects.toThrow(
      /RESERVATION_TOKEN_SECRET.*32.*characters/,
    );
  });
});

describe("LINE env production validation", () => {
  it("passes in production with all LINE env vars set", async () => {
    process.env = { ...BASE_PROD_ENV, ...LINE_FULL_ENV };
    await expect(import("@/lib/env")).resolves.toBeDefined();
  });

  it("passes in production when LINE is not enabled (no LINE vars)", async () => {
    process.env = { ...BASE_PROD_ENV };
    await expect(import("@/lib/env")).resolves.toBeDefined();
  });

  it("does not crash global env parsing when LINE_CHANNEL_SECRET is missing", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      LINE_CHANNEL_ACCESS_TOKEN: "token",
      LINE_LOGIN_CHANNEL_ID: "id",
      LINE_LINK_TOKEN_PEPPER: "a".repeat(32),
      // LINE_CHANNEL_SECRET intentionally omitted
    };
    delete process.env.LINE_CHANNEL_SECRET;
    await expect(import("@/lib/env")).resolves.toBeDefined();
  });

  it("does not crash global env parsing when LINE_LINK_TOKEN_PEPPER is missing", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      LINE_CHANNEL_ACCESS_TOKEN: "token",
      LINE_CHANNEL_SECRET: "secret",
      LINE_LOGIN_CHANNEL_ID: "id",
      // LINE_LINK_TOKEN_PEPPER intentionally omitted
    };
    delete process.env.LINE_LINK_TOKEN_PEPPER;
    await expect(import("@/lib/env")).resolves.toBeDefined();
  });

  it("fails when LINE_LINK_TOKEN_PEPPER is shorter than 32 chars in production", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      ...LINE_FULL_ENV,
      LINE_LINK_TOKEN_PEPPER: "too-short",
    };
    await expect(import("@/lib/env")).rejects.toThrow(
      /LINE_LINK_TOKEN_PEPPER.*32.*characters/
    );
  });

  it("passes when LINE_LINK_TOKEN_PEPPER is exactly 32 chars", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      ...LINE_FULL_ENV,
      LINE_LINK_TOKEN_PEPPER: "a".repeat(32),
    };
    await expect(import("@/lib/env")).resolves.toBeDefined();
  });

  it("parses LINE_PHONE_AUTO_ATTACH_ENABLED=false as false", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      LINE_PHONE_AUTO_ATTACH_ENABLED: "false",
    };
    const { isLinePhoneAutoAttachEnabled } = await import("@/lib/env");
    expect(isLinePhoneAutoAttachEnabled()).toBe(false);
  });

  it("keeps phone auto attach disabled when the legacy flag is true", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      LINE_PHONE_AUTO_ATTACH_ENABLED: "true",
    };
    const { isLinePhoneAutoAttachEnabled } = await import("@/lib/env");
    expect(isLinePhoneAutoAttachEnabled()).toBe(false);
  });

  it("parses LINE_RESERVATION_LOOKUP_LINK_ENABLED=false as false", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      LINE_RESERVATION_LOOKUP_LINK_ENABLED: "false",
    };
    const { isLineReservationLookupLinkEnabled } = await import("@/lib/env");
    expect(isLineReservationLookupLinkEnabled()).toBe(false);
  });

  it("keeps date/phone/name lookup disabled when the legacy flag is true", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      LINE_RESERVATION_LOOKUP_LINK_ENABLED: "true",
    };
    const { isLineReservationLookupLinkEnabled } = await import("@/lib/env");
    expect(isLineReservationLookupLinkEnabled()).toBe(false);
  });

  it("does not crash global env parsing when NEXT_PUBLIC_LIFF_BOOKING_ID is missing", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      ...LINE_FULL_ENV,
    };
    delete process.env.NEXT_PUBLIC_LIFF_BOOKING_ID;
    await expect(import("@/lib/env")).resolves.toBeDefined();
  });

  it("does not crash global env parsing when NEXT_PUBLIC_LIFF_LINK_ID is missing", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      ...LINE_FULL_ENV,
    };
    delete process.env.NEXT_PUBLIC_LIFF_LINK_ID;
    await expect(import("@/lib/env")).resolves.toBeDefined();
  });
});

describe("LIFF env split", () => {
  it("accepts NEXT_PUBLIC_LIFF_BOOKING_ID and NEXT_PUBLIC_LIFF_LINK_ID in env schema", async () => {
    process.env = {
      ...BASE_PROD_ENV,
      ...LINE_FULL_ENV,
      NEXT_PUBLIC_LIFF_BOOKING_ID: "123-booking",
      NEXT_PUBLIC_LIFF_LINK_ID: "456-link",
    };
    const { env } = await import("@/lib/env");
    expect(env.NEXT_PUBLIC_LIFF_BOOKING_ID).toBe("123-booking");
    expect(env.NEXT_PUBLIC_LIFF_LINK_ID).toBe("456-link");
  });
});
