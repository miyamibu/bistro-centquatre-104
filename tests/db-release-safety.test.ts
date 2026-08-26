import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const releaseScript = resolve(repoRoot, "scripts/check-release-safety.mjs");
const isolatedCwd = mkdtempSync(resolve(tmpdir(), "bistro-release-safety-"));
const cronConfigPath = resolve(isolatedCwd, "vercel.json");

const baseReleaseEnv: Record<string, string> = {
  PATH: "",
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://bistro:bistro@127.0.0.1:5432/bistro",
  BASE_URL: "https://bistro.invalid",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "safe-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "safe-service-role-key",
  STAFF_SESSION_MAX_AGE_SECONDS: "28800",
  CRON_SECRET: "safe-cron-secret",
  BACKUP_EXPORT_SECRET: "safe-backup-export-secret",
  RATE_LIMIT_HASH_SECRET: "rate-limit-secret-value-32-characters",
  RESERVATION_TOKEN_SECRET: "reservation-token-secret-value-32-characters",
  LINE_LINK_TOKEN_PEPPER: "line-link-token-pepper-value-32-characters",
  BACKUP_ENCRYPTION_KEY: "backup-encryption-key-value-32-characters",
  BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: "bank-history-encryption-key",
};

const completeMailEnv: Record<string, string> = {
  DIRECT_URL: "postgresql://bistro:bistro@127.0.0.1:5432/bistro",
  NEXT_PUBLIC_APP_URL: "https://bistro.invalid",
  PRODUCTION_HOST_PROVIDER: "netlify",
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

  it("requires the reservation bearer-token derivation secret", () => {
    const result = runReleaseCheck("production", {
      set: completeMailEnv,
      unset: ["RESERVATION_TOKEN_SECRET"],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("RESERVATION_TOKEN_SECRET");
  });

  it("requires the LINE link-token derivation secret", () => {
    const result = runReleaseCheck("production", {
      set: completeMailEnv,
      unset: ["LINE_LINK_TOKEN_PEPPER"],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LINE_LINK_TOKEN_PEPPER");
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

  it("rejects commercial production traffic on Vercel Hobby", () => {
    const result = runReleaseCheck("production", {
      set: {
        ...completeMailEnv,
        BASE_URL: "https://bistro-centquatre-104.vercel.app",
        NEXT_PUBLIC_APP_URL: "https://bistro-centquatre-104.vercel.app",
        PRODUCTION_HOST_PROVIDER: "vercel",
        VERCEL_PLAN: "hobby",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must be netlify");
    expect(result.stderr).toContain("must not point commercial production traffic to Vercel Hobby");
  });

  it("rejects mismatched public and server origins", () => {
    const result = runReleaseCheck("preview", {
      set: {
        ...completeMailEnv,
        NEXT_PUBLIC_APP_URL: "https://other-bistro.invalid",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must use the same origin");
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

  it.each(["preview", "production"] as const)(
    "rejects SendGrid for %s because provider-side idempotency is not part of the release contract",
    (mode) => {
      const result = runReleaseCheck(mode, {
        set: {
          ...completeMailEnv,
          EMAIL_PROVIDER: "sendgrid",
          EMAIL_API_KEY: "nonsecret-sendgrid-api-key",
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("EMAIL_PROVIDER must be resend");
    },
  );

  it("rejects Hobby when vercel.json contains a five-minute cron", () => {
    writeFileSync(
      cronConfigPath,
      JSON.stringify({
        crons: [{ path: "/api/crons/process-reservation-emails", schedule: "*/5 * * * *" }],
      }),
    );

    const result = runReleaseCheck("preview", {
      set: { ...completeMailEnv, VERCEL_CONFIG_PATH: cronConfigPath, VERCEL_PLAN: "hobby" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("High-frequency Vercel Cron is forbidden");
  });

  it("rejects a production five-minute Vercel cron when no plan is declared", () => {
    writeFileSync(
      cronConfigPath,
      JSON.stringify({
        crons: [{ path: "/api/crons/process-reservation-emails", schedule: "*/5 * * * *" }],
      }),
    );

    const result = runReleaseCheck("production", {
      set: { ...completeMailEnv, VERCEL_CONFIG_PATH: cronConfigPath },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("High-frequency Vercel Cron is forbidden");
  });

  it("rejects Pro for a production five-minute cron because Vercel stays Hobby", () => {
    writeFileSync(
      cronConfigPath,
      JSON.stringify({
        crons: [{ path: "/api/crons/process-reservation-emails", schedule: "*/5 * * * *" }],
      }),
    );

    const result = runReleaseCheck("production", {
      set: { ...completeMailEnv, VERCEL_CONFIG_PATH: cronConfigPath, VERCEL_PLAN: "pro" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("High-frequency Vercel Cron is forbidden");
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

    const managementTokenMigration = readFileSync(
      resolve(
        repoRoot,
        "prisma/migrations/20260731100000_add_reservation_management_token/migration.sql",
      ),
      "utf8",
    );
    expect(managementTokenMigration).toMatch(
      /ALTER TABLE "ReservationManagementToken" ENABLE ROW LEVEL SECURITY;/,
    );

    const webhookInboxMigration = readFileSync(
      resolve(
        repoRoot,
        "prisma/migrations/20260731101000_add_line_webhook_inbox/migration.sql",
      ),
      "utf8",
    );
    expect(webhookInboxMigration).toContain(
      'ALTER TABLE "LineWebhookInbox" ENABLE ROW LEVEL SECURITY;',
    );

    const webhookRetentionMigration = readFileSync(
      resolve(
        repoRoot,
        "prisma/migrations/20260824140000_minimize_line_webhook_inbox_retention/migration.sql",
      ),
      "utf8",
    );
    expect(webhookRetentionMigration).toContain("SECURITY DEFINER");
    expect(webhookRetentionMigration).toContain(
      `WHERE inbox."status" = 'PROCESSED'::public."LineWebhookInboxStatus"`,
    );
    expect(webhookRetentionMigration).toContain("max_rows > 200");
    expect(webhookRetentionMigration).toContain("REVOKE ALL ON FUNCTION");

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
      "FAIL expired reservation LINE link token cleanup function is missing",
      "FAIL expired LINE link cleanup exposed to non-runtime roles",
    ]) {
      expect(verifySql).toContain(failure);
    }

    for (const table of [
      "ReservationEmailOutbox",
      "ReservationStatusAuditLog",
      "ReservationIdempotency",
      "ReservationLineLinkToken",
      "ReservationManagementToken",
      "NotificationEvent",
      "LineWebhookInbox",
      "ReservationRateLimitEvent",
      "LineFriend",
      "LineCustomerLink",
      "DailyJournalEntry",
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
    for (const table of [
      "ReservationLineLinkToken",
      "ReservationManagementToken",
      "NotificationEvent",
      "LineWebhookInbox",
      "ReservationIdempotency",
      "LineFriend",
      "LineCustomerLink",
      "DailyJournalEntry",
    ]) {
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
      "ReservationIdempotency",
      "ReservationLineLinkToken",
      "ReservationManagementToken",
      "NotificationEvent",
      "LineWebhookInbox",
      "ReservationRateLimitEvent",
      "LineFriend",
      "LineCustomerLink",
      "DailyJournalEntry",
    ]) {
      expect(permissions).toContain(`\`${table}\``);
    }

    expect(permissions).toContain("REVOKE DELETE, TRUNCATE");
    expect(permissions).toContain("SET LOCAL bistro.verify_runtime_role");
    expect(permissions).toContain("-v ON_ERROR_STOP=1");
  });
});
