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
      ADMIN_BASIC_USER: "admin",
      ADMIN_BASIC_PASS: "pass",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      CRON_SECRET: "cron-secret",
    };
    delete process.env.BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY;

    await expect(import("@/lib/env")).rejects.toThrow(
      /BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: is required in production/
    );
  });
});
