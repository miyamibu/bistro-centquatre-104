import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("production-go regression contracts", () => {
  it("keeps the booking page initial render independent from direct database reads", () => {
    const bookingPage = source("src/app/booking/page.tsx");

    expect(bookingPage).not.toContain('from "@/lib/prisma"');
    expect(bookingPage).not.toContain("ensureReservationSchemaReady");
    expect(bookingPage).not.toContain("getMonthlyAvailability(");
    expect(bookingPage).toContain("<ReserveForm");
    expect(bookingPage).toContain("autoSelectFirstBookableDate={!hasValidExplicitDate}");

    const reserveForm = source("src/components/reserve-form.tsx");
    expect(reserveForm).toContain("findFirstWebBookableDate(currentPeriodDays, form.date)");
    expect(reserveForm).toContain("initialFutureDateSearchStartedRef");
    expect(reserveForm).toContain("AVAILABILITY_REQUEST_TIMEOUT_MS = 20_000");
  });

  it("does not make future workspace bundles capture every Git ref", () => {
    const backupScript = source("scripts/run-local-safety-backups.mjs");

    expect(backupScript).not.toContain('["bundle", "create", bundlePath, "--all"]');
    expect(backupScript).toContain(
      '["bundle", "create", bundlePath, "HEAD", "--branches", "--tags"]'
    );
  });

  it("provides reduced-motion and named modal focus containment", () => {
    const globalCss = source("src/app/globals.css");
    const gallery = source("src/components/gallery-viewer.tsx");
    const homepage = source("src/app/page.tsx");

    expect(globalCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(gallery).toContain('event.key !== "Tab"');
    expect(gallery).toContain('aria-modal="true"');
    expect(homepage).toContain('aria-label={`写真拡大: ${lightbox.alt}`}');
    expect(homepage).toContain("lightboxDialogRef.current");
  });

  it("bounds picture database fallback without a raw TCP probe", () => {
    const picturePage = source("src/app/picture/page.tsx");

    expect(picturePage).not.toContain('from "node:net"');
    expect(picturePage).toContain("PHOTO_QUERY_TIMEOUT_MS = 750");
    expect(picturePage).toContain("Promise.race([query, boundedFallback])");
  });

  it("keeps CI DB-test auth exclusions explicit and non-default", () => {
    const dbTestRunner = source("scripts/run-safe-db-tests.mjs");
    const reservationWorkflow = source(".github/workflows/reservation-hardening.yml");
    const securityWorkflow = source(".github/workflows/security-checks.yml");

    expect(dbTestRunner).toContain('process.env.SKIP_STAFF_AUTH_DB_TESTS === "1"');
    expect(dbTestRunner).toContain("TEST_STAFF_AUTH_COOKIE");
    expect(reservationWorkflow).toContain('SKIP_STAFF_AUTH_DB_TESTS: "1"');
    expect(securityWorkflow).toContain('SKIP_STAFF_AUTH_DB_TESTS: "1"');
  });

  it("keeps Vercel Hobby free of cron jobs and uses bounded public GitHub schedulers", () => {
    const vercel = JSON.parse(source("vercel.json")) as Record<string, unknown>;
    const outboxWorkflow = source(".github/workflows/production-notification-outbox-drain.yml");
    const maintenanceWorkflow = source(".github/workflows/production-daily-maintenance.yml");

    expect(vercel).not.toHaveProperty("crons");
    expect(vercel).not.toHaveProperty("redirects");
    expect(source("vercel.json")).not.toContain("vercel.app");
    expect(source("src/lib/after-response.ts")).not.toContain("process.env.VITEST");
    expect(source("scripts/check-release-safety.mjs")).not.toContain("VERCEL_PLAN=pro");
    expect(source("scripts/check-release-safety.mjs")).toContain(
      "EMAIL_PROVIDER must be resend for Preview/Production provider idempotency",
    );
    expect(outboxWorkflow).toContain('cron: "2-57/5 * * * *"');
    expect(outboxWorkflow).toContain("workflow_dispatch:");
    expect(outboxWorkflow).toContain("runs-on: ubuntu-latest");
    expect(maintenanceWorkflow).toContain('cron: "17 18,19,20 * * *"');
    expect(outboxWorkflow).not.toMatch(/actions\/checkout|actions\/cache|upload-artifact/i);
    expect(outboxWorkflow).toContain("--max-time 30");
    expect(maintenanceWorkflow).toContain("while (( reminder_pages < 4 ))");
    expect(maintenanceWorkflow).toContain("maintenance_deadline_epoch");
    expect(maintenanceWorkflow).toContain("nextCursor");
  });

  it("derives canonical URLs from the selected production origin", () => {
    const seo = source("src/lib/seo.ts");
    const releaseSafety = source("scripts/check-release-safety.mjs");

    expect(seo).toContain("process.env.NEXT_PUBLIC_APP_URL");
    expect(seo).toContain("process.env.URL");
    expect(releaseSafety).toContain('PRODUCTION_HOST_PROVIDER must be netlify');
    expect(releaseSafety).toContain('BASE_URL and NEXT_PUBLIC_APP_URL must use the same origin');
  });

  it("protects scheduler and manual-drain audit data with RLS", () => {
    const migration = source("prisma/migrations/20260826090000_add_scheduler_heartbeat/migration.sql");
    const privilegeMigration = source("prisma/migrations/20260826091000_enforce_runtime_minimum_privileges/migration.sql");
    const policyMigration = source("prisma/migrations/20260826092000_drop_runtime_delete_policy/migration.sql");
    const operationalPolicyMigration = source(
      "prisma/migrations/20260831014000_allow_runtime_operational_audit_writes/migration.sql",
    );
    const policies = source("supabase/rls-policies.sql");
    const verify = source("supabase/verify.sql");

    expect(migration).toContain('ALTER TABLE "SchedulerHeartbeat" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "OutboxDrainAuditLog" ENABLE ROW LEVEL SECURITY');
    for (const table of ["SchedulerHeartbeat", "OutboxDrainAuditLog"]) {
      expect(policies).toContain(`public."${table}" enable row level security`);
    }
    expect(policies).toContain('scheduler_heartbeat_deny_anon_all');
    expect(policies).toContain('outbox_drain_audit_deny_authenticated_all');
    expect(privilegeMigration).toContain("REVOKE DELETE, TRUNCATE");
    expect(privilegeMigration).toContain('"ReservationLineLinkToken"');
    expect(privilegeMigration).toContain('"OutboxDrainAuditLog"');
    expect(policyMigration).toContain('DROP POLICY IF EXISTS "bistro_rt_reservationlinelinktoken_delete"');
    expect(operationalPolicyMigration).toContain("FOR SELECT TO %I USING (true)");
    expect(operationalPolicyMigration).toContain("FOR INSERT TO %I WITH CHECK (true)");
    expect(operationalPolicyMigration).toContain(
      "FOR UPDATE TO %I USING (true) WITH CHECK (true)",
    );
    expect(operationalPolicyMigration).not.toMatch(/FOR (?:ALL|DELETE)/);
    expect(verify).toContain("missing required RLS policies");
  });

  it("serializes administrator private-block creation with reservation writes", () => {
    const route = source("src/app/api/admin/private-block/route.ts");
    const lock = route.indexOf("await acquireReservationAdvisoryLock(tx, date, servicePeriod)");
    const read = route.indexOf("await findReservationsCompat(tx");

    expect(lock).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(lock);
  });

  it("removes expired LINE link tokens only through a bounded privileged function", () => {
    const route = source("src/app/api/crons/delete-old-histories/route.ts");
    const migration = source(
      "prisma/migrations/20260826130000_expired_line_link_token_cleanup/migration.sql",
    );
    const previewGrant = source(
      "prisma/migrations/20260826131000_grant_preview_line_link_cleanup/migration.sql",
    );

    expect(route).toContain("cleanup_expired_reservation_line_link_tokens");
    expect(route).not.toContain("reservationLineLinkToken.deleteMany");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog, public");
    expect(migration).toContain("max_rows > 500");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).toContain("TO bistro_app_runtime");
    expect(previewGrant).toContain("current_database() = 'bistro_preview'");
    expect(previewGrant).toContain("TO bistro_preview_runtime");
  });

  it("bounds ephemeral security retention and minimizes historical audit IP data", () => {
    const route = source("src/app/api/crons/delete-old-histories/route.ts");
    const migration = source(
      "prisma/migrations/20260826140000_ephemeral_security_cleanup_and_audit_ip_minimization/migration.sql",
    );
    const verify = source("supabase/verify.sql");

    expect(route).toContain("cleanup_ephemeral_reservation_security_state");
    expect(route).toContain("RATE_LIMIT_EVENT_RETENTION_HOURS = 48");
    expect(route).toContain("IDEMPOTENCY_RETENTION_DAYS = 200");
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("max_rows_per_table > 500");
    expect(migration).toContain('SET "ipAddress" = NULL');
    expect(migration).toContain("TO bistro_app_runtime");
    expect(migration).toContain("TO bistro_preview_runtime");
    expect(verify).toContain("PASS ephemeral reservation security cleanup privilege boundary");
  });

  it("records LINE reminder scheduler outcomes and rate-limits availability reads", () => {
    const reminder = source("src/app/api/crons/remind/route.ts");
    const availability = source("src/app/api/availability/route.ts");
    const monthly = source("src/app/api/availability/monthly/route.ts");

    expect(reminder).toContain('markSchedulerStarted("LINE_REMINDER"');
    expect(reminder).toContain('markSchedulerSucceeded("LINE_REMINDER"');
    expect(reminder).toContain('markSchedulerFailed("LINE_REMINDER"');
    expect(source("src/app/api/crons/cancel-expired-orders/route.ts")).toContain(
      'markSchedulerSucceeded("ORDER_EXPIRY"',
    );
    expect(source("src/app/api/crons/delete-old-histories/route.ts")).toContain(
      'markSchedulerSucceeded("DATA_RETENTION"',
    );
    expect(availability).toContain("enforceAvailabilityRateLimit(request)");
    expect(monthly).toContain("enforceAvailabilityRateLimit(request)");
    expect(availability).toContain("RATE_LIMIT_CHECK_FAILED");
    expect(monthly).toContain("RATE_LIMIT_CHECK_FAILED");
  });

  it("keeps the Netlify provider failsafe daily, bounded, and secret-safe", () => {
    const config = source("netlify.toml");
    const build = source("scripts/netlify-build.mjs");
    const failsafe = source("netlify/functions/outbox-failsafe.mjs");

    expect(config).toContain('command = "node scripts/netlify-build.mjs"');
    expect(build).toContain('context === "production"');
    expect(build).toContain('"check:release:production"');
    expect(build).toContain('context === "deploy-preview" || context === "branch-deploy"');
    expect(build).toContain('"check:release:preview"');
    expect(build.indexOf("runNpmScript(releaseCheck)")).toBeLessThan(
      build.indexOf('runNpmScript("build")'),
    );
    expect(config).toContain("[functions.outbox-failsafe]");
    expect(config).toContain('schedule = "23 18 * * *"');
    expect(failsafe).toContain('AbortSignal.timeout(10_000)');
    expect(failsafe).toContain('"X-Scheduler-Kind": "provider-failsafe"');
    expect(failsafe).toContain('lane: "LINE_REMINDER"');
    expect(failsafe).toContain('/api/crons/remind?batchSize=100&deadlineMs=8000');
    expect(failsafe).toContain("Promise.allSettled");
    expect(failsafe).not.toMatch(/console\.(?:log|info|warn|error)\([^\n]*secret/i);
  });

  it("allows the serialized reservation transaction to survive cross-region latency", () => {
    const reservationRoute = source("src/app/api/reservations/route.ts");

    expect(reservationRoute).toContain("RESERVATION_TRANSACTION_MAX_WAIT_MS = 5_000");
    expect(reservationRoute).toContain("RESERVATION_TRANSACTION_TIMEOUT_MS = 20_000");
    expect(reservationRoute).toContain("maxWait: RESERVATION_TRANSACTION_MAX_WAIT_MS");
    expect(reservationRoute).toContain("timeout: RESERVATION_TRANSACTION_TIMEOUT_MS");
    expect(reservationRoute).toContain(
      "isolationLevel: Prisma.TransactionIsolationLevel.Serializable",
    );
  });

  it("keeps the production-disabled PDF converter out of the Netlify SSR trace", () => {
    const route = source("src/app/api/pdf-to-image/route.ts");
    const nextConfig = source("next.config.mjs");
    const productionGuard = route.indexOf('process.env.NODE_ENV === "production"');
    const dynamicImport = route.indexOf('await import("puppeteer")');

    expect(route).not.toContain('import puppeteer from "puppeteer"');
    expect(productionGuard).toBeGreaterThan(-1);
    expect(dynamicImport).toBeGreaterThan(productionGuard);
    expect(nextConfig).toContain('"/api/pdf-to-image"');
    expect(nextConfig).toContain('"public/**"');
    expect(nextConfig).toContain('"node_modules/puppeteer-core/**"');
  });

  it("keeps cancellation at the fixed 24-hour policy boundary", () => {
    const policy = source("src/lib/cancellation-policy.ts");
    const env = source("src/lib/env.ts");
    const example = source(".env.example");

    expect(policy).toContain("SELF_SERVICE_CANCELLATION_CUTOFF_HOURS = 24");
    expect(env).not.toContain("SELF_SERVICE_CANCELLATION_CUTOFF_HOURS");
    expect(example).not.toContain("SELF_SERVICE_CANCELLATION_CUTOFF_HOURS");
  });

  it("creates pre-migration DB safety dumps without plaintext-at-rest or secret arguments", () => {
    const script = source("scripts/recovery/create-encrypted-db-dump.mjs");

    expect(script).toContain('dump.stdout.pipe(encrypt.stdin)');
    expect(script).toContain('"-pass", "env:DB_DUMP_ENCRYPTION_KEY"');
    expect(script).toContain('restoreListVerified: true');
    expect(script).not.toContain('"--dbname"');
    expect(script).not.toContain("writeFile(partialPath");
  });
});
