import { describe, expect, it } from "vitest";

function joinTokens(...parts: string[]) {
  return parts.join("");
}

const RULE_RAW_DELETE_RESERVATION = joinTokens("raw DELETE ", "Reservation");
const RULE_PRISMA_DELETE_MANY = joinTokens("prisma reservation.", "deleteMany");
const RULE_RAW_TRUNCATE_RESERVATION = joinTokens("raw TRUNCATE ", "Reservation");
const RULE_RAW_DROP_TABLE_RESERVATION = joinTokens("raw DROP TABLE ", "Reservation");
const RULE_PROTECTED_FS_DELETE = joinTokens(
  "protected backup or evidence fs ",
  "delete"
);

type Violation = {
  rule: string;
};

async function scanSource(relativePath: string, source: string): Promise<Violation[]> {
  const scannerModule = (await import("../scripts/security/destructive-reservation-scanner.mjs")) as {
    scanSource: (path: string, contents: string) => Violation[];
  };
  return scannerModule.scanSource(relativePath, source);
}

describe("destructive reservation scanner", () => {
  it("detects raw Reservation delete SQL", async () => {
    const source = joinTokens("DELETE FROM ", '"Reservation"');
    const violations = await scanSource("src/example.ts", source);
    expect(violations.some((violation) => violation.rule === RULE_RAW_DELETE_RESERVATION)).toBe(
      true
    );
  });

  it("detects prisma reservation.deleteMany", async () => {
    const source = joinTokens("await prisma.", "reservation.", "delete", "Many({});");
    const violations = await scanSource("src/example.ts", source);
    expect(violations.some((violation) => violation.rule === RULE_PRISMA_DELETE_MANY)).toBe(true);
  });

  it("detects Reservation truncate SQL", async () => {
    const source = joinTokens("TRUNCATE ", '"Reservation"');
    const violations = await scanSource("scripts/example.mjs", source);
    expect(violations.some((violation) => violation.rule === RULE_RAW_TRUNCATE_RESERVATION)).toBe(
      true
    );
  });

  it("detects Reservation drop table SQL", async () => {
    const source = joinTokens("DROP TABLE ", '"Reservation"');
    const violations = await scanSource("prisma/example.sql", source);
    expect(
      violations.some((violation) => violation.rule === RULE_RAW_DROP_TABLE_RESERVATION)
    ).toBe(true);
  });

  it("allows the guarded destructive test helper only when required markers exist", async () => {
    const source = [
      'import { assertDestructiveCleanupAllowed } from "./assert-test-database";',
      "// RESERVATION_DESTRUCTIVE_TEST_ONLY",
      "assertDestructiveCleanupAllowed();",
      joinTokens('await prisma.$executeRawUnsafe(\'', "DELETE FROM ", '"Reservation"', "'\");"),
    ].join("\n");
    const violations = await scanSource("tests/utils/reservation-destructive-cleanup.ts", source);
    expect(violations).toEqual([]);
  });

  it("rejects a test cleanup helper that is missing the test-db guard", async () => {
    const source = joinTokens('await prisma.$executeRawUnsafe(\'', "DELETE FROM ", '"Reservation"', "'\");");
    const violations = await scanSource("tests/utils/reservation-destructive-cleanup.ts", source);
    expect(violations.some((violation) => violation.rule.startsWith("allowlist guard missing"))).toBe(
      true
    );
  });

  it("detects backup and recovery evidence deletion code", async () => {
    const protectedPath = joinTokens("backups/", "reservation", "-status/2026-04-21.json");
    const source = joinTokens(
      'import fs from "node:fs/promises";\n',
      'await fs.unlink("',
      protectedPath,
      '");'
    );
    const violations = await scanSource("scripts/example.mjs", source);
    expect(violations.some((violation) => violation.rule === RULE_PROTECTED_FS_DELETE)).toBe(true);
  });
});
