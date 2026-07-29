import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const releaseScript = resolve(repoRoot, "scripts/check-release-safety.mjs");
const isolatedCwd = mkdtempSync(resolve(tmpdir(), "bistro-release-safety-"));

const baseReleaseEnv: Record<string, string> = {
  PATH: "",
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://bistro:bistro@127.0.0.1:5432/bistro",
  BASE_URL: "https://bistro.invalid",
  ADMIN_BASIC_USER: "operator",
  ADMIN_BASIC_PASS: "strong-admin-password",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "safe-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "safe-service-role-key",
  CRON_SECRET: "safe-cron-secret",
  BACKUP_EXPORT_SECRET: "safe-backup-export-secret",
  RATE_LIMIT_HASH_SECRET: "rate-limit-secret-value-32-characters",
  BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: "bank-history-encryption-key",
};

const completeMailEnv: Record<string, string> = {
  DIRECT_URL: "postgresql://bistro:bistro@127.0.0.1:5432/bistro",
  STORE_NOTIFY_EMAIL: "operations@bistro.invalid",
  EMAIL_PROVIDER: "resend",
  EMAIL_FROM: "reservations@bistro.invalid",
  RESEND_API_KEY: "nonsecret-resend-api-key",
};

afterAll(() => {
  rmSync(isolatedCwd, { recursive: true, force: true });
});

function runReleaseCheck(
  mode: "local-build" | "preview" | "production",
  options: {
    set?: Record<string, string>;
    unset?: string[];
  } = {},
) {
  const env: NodeJS.ProcessEnv = {
    ...baseReleaseEnv,
    ...options.set,
    NODE_ENV: "test",
  };

  for (const key of options.unset ?? []) {
    delete env[key];
  }

  return spawnSync(process.execPath, [releaseScript, mode], {
    cwd: isolatedCwd,
    encoding: "utf8",
    env,
  });
}

describe("release safety environment contract", () => {
  it("allows local-build without DIRECT_URL or mail delivery settings", () => {
    const result = runReleaseCheck("local-build");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Required env and mail configuration checks passed.");
    expect(result.stderr).not.toContain("Missing required env keys: DIRECT_URL");
  });

  it.each(["preview", "production"] as const)(
    "requires DIRECT_URL for %s",
    (mode) => {
      const result = runReleaseCheck(mode, { set: completeMailEnv, unset: ["DIRECT_URL"] });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Missing required env keys: DIRECT_URL");
    },
  );

  it("accepts a complete production Resend configuration", () => {
    const result = runReleaseCheck("production", { set: completeMailEnv });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Required env and mail configuration checks passed.");
  });

  it.each([
    {
      name: "missing store recipient",
      set: completeMailEnv,
      unset: ["STORE_NOTIFY_EMAIL"],
      expected: "STORE_NOTIFY_EMAIL",
    },
    {
      name: "missing sender",
      set: completeMailEnv,
      unset: ["EMAIL_FROM"],
      expected: "EMAIL_FROM",
    },
    {
      name: "missing Resend API key",
      set: completeMailEnv,
      unset: ["RESEND_API_KEY", "EMAIL_API_KEY"],
      expected: "EMAIL_PROVIDER=resend requires RESEND_API_KEY or EMAIL_API_KEY",
    },
    {
      name: "missing SendGrid API key",
      set: { ...completeMailEnv, EMAIL_PROVIDER: "sendgrid" },
      unset: ["RESEND_API_KEY", "EMAIL_API_KEY"],
      expected: "EMAIL_PROVIDER=sendgrid requires EMAIL_API_KEY",
    },
    {
      name: "unsupported provider",
      set: { ...completeMailEnv, EMAIL_PROVIDER: "smtp" },
      unset: [],
      expected: "EMAIL_PROVIDER must be either resend or sendgrid",
    },
  ])("rejects $name", ({ set, unset, expected }) => {
    const result = runReleaseCheck("preview", { set, unset });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expected);
  });

  it("accepts EMAIL_API_KEY as the documented Resend fallback", () => {
    const result = runReleaseCheck("preview", {
      set: { ...completeMailEnv, EMAIL_API_KEY: "nonsecret-fallback-api-key" },
      unset: ["RESEND_API_KEY"],
    });

    expect(result.status, result.stderr).toBe(0);
  });
});

describe("database release safety contracts", () => {
  it("enables RLS in the reservation email outbox migration", () => {
    const migration = readFileSync(
      resolve(
        repoRoot,
        "prisma/migrations/20260728090000_add_reservation_email_outbox/migration.sql",
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /ALTER TABLE "ReservationEmailOutbox" ENABLE ROW LEVEL SECURITY;/,
    );

    const relatedMigration = readFileSync(
      resolve(
        repoRoot,
        "prisma/migrations/20260728093000_restrict_reservation_related_deletes/migration.sql",
      ),
      "utf8",
    );
    expect(relatedMigration).toContain(
      'ALTER TABLE "ReservationLineLinkToken" ENABLE ROW LEVEL SECURITY;',
    );
    expect(relatedMigration).toContain(
      'ALTER TABLE "NotificationEvent" ENABLE ROW LEVEL SECURITY;',
    );
  });

  it("keeps verify.sql fail-fast for tables, RLS, policies, FKs, and runtime grants", () => {
    const verifySql = readFileSync(resolve(repoRoot, "supabase/verify.sql"), "utf8");

    for (const failure of [
      "FAIL required tables missing",
      "FAIL RLS disabled",
      "FAIL required RLS policies missing or invalid",
      "FAIL reservation FKs missing",
      "FAIL configured runtime role does not exist",
      "FAIL runtime role % missing required privileges",
      "FAIL runtime role % has forbidden privileges",
    ]) {
      expect(verifySql).toContain(failure);
    }

    for (const table of [
      "ReservationEmailOutbox",
      "ReservationStatusAuditLog",
      "ReservationLineLinkToken",
      "NotificationEvent",
      "ReservationRateLimitEvent",
    ]) {
      expect(verifySql).toContain(`'${table}'`);
    }

    expect(verifySql).toContain("current_setting('bistro.verify_runtime_role', true)");
    expect(verifySql).toContain("has_table_privilege(");
    expect(verifySql).toContain("constraint_record.confdeltype = 'r'");

    const policiesSql = readFileSync(
      resolve(repoRoot, "supabase/rls-policies.sql"),
      "utf8",
    );
    for (const table of ["ReservationLineLinkToken", "NotificationEvent"]) {
      expect(policiesSql).toContain(`public."${table}" enable row level security`);
      expect(policiesSql).toContain(`public."${table}" for all to service_role`);
    }
  });

  it("documents minimal grants and destructive privilege denial for all protected tables", () => {
    const permissions = readFileSync(
      resolve(repoRoot, "docs/recovery/production-db-permissions.md"),
      "utf8",
    );

    for (const table of [
      "ReservationEmailOutbox",
      "ReservationStatusAuditLog",
      "ReservationLineLinkToken",
      "NotificationEvent",
      "ReservationRateLimitEvent",
    ]) {
      expect(permissions).toContain(`\`${table}\``);
    }

    expect(permissions).toContain("REVOKE DELETE, TRUNCATE");
    expect(permissions).toContain("SET LOCAL bistro.verify_runtime_role");
    expect(permissions).toContain("-v ON_ERROR_STOP=1");
  });
});
