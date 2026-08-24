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
});
