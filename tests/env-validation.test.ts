import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

describe("Production env validation", () => {
  it("fails fast when BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY is missing", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
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
    };
    delete process.env.BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY;

    await expect(import("@/lib/env")).rejects.toThrow(
      /BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: is required in production/
    );
  });

  it("fails fast when BACKUP_EXPORT_SECRET is missing in production", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      STAFF_SESSION_MAX_AGE_SECONDS: "28800",
      CRON_SECRET: "cron-secret",
      RATE_LIMIT_HASH_SECRET: "rate-limit-hash-secret-32chars-min",
      RESERVATION_TOKEN_SECRET: "reservation-token-secret-32chars-min",
      BACKUP_ENCRYPTION_KEY: "backup-encryption-key-32-characters",
      BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: "bank-history-key",
    };
    delete process.env.BACKUP_EXPORT_SECRET;

    await expect(import("@/lib/env")).rejects.toThrow(
      /BACKUP_EXPORT_SECRET: is required in production/
    );
  });

  it("fails fast when RATE_LIMIT_HASH_SECRET is missing in production", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      STAFF_SESSION_MAX_AGE_SECONDS: "28800",
      CRON_SECRET: "cron-secret",
      BACKUP_EXPORT_SECRET: "backup-export-secret",
      RESERVATION_TOKEN_SECRET: "reservation-token-secret-32chars-min",
      BACKUP_ENCRYPTION_KEY: "backup-encryption-key-32-characters",
      BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: "bank-history-key",
    };
    delete process.env.RATE_LIMIT_HASH_SECRET;

    await expect(import("@/lib/env")).rejects.toThrow(
      /RATE_LIMIT_HASH_SECRET: is required in production/
    );
  });

  it("rejects placeholder RATE_LIMIT_HASH_SECRET in production", async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      STAFF_SESSION_MAX_AGE_SECONDS: "28800",
      CRON_SECRET: "cron-secret",
      BACKUP_EXPORT_SECRET: "backup-export-secret",
      RATE_LIMIT_HASH_SECRET: "replace-with-32-char-minimum-rate-limit-secret",
      BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: "bank-history-key",
      RESERVATION_TOKEN_SECRET: "reservation-token-secret-32chars-min",
      BACKUP_ENCRYPTION_KEY: "backup-encryption-key-32-characters",
    };

    await expect(import("@/lib/env")).rejects.toThrow(
      /RATE_LIMIT_HASH_SECRET: must be a non-placeholder value/
    );
  });
});
