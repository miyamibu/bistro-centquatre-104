import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dumpScript = readFileSync("scripts/recovery/create-encrypted-db-dump.mjs", "utf8");
const restoreScript = readFileSync(
  "scripts/recovery/restore-encrypted-db-dump-disposable.mjs",
  "utf8",
);

describe("database safety dump and disposable restore", () => {
  it("uses matching PostgreSQL 17 container tooling and authenticated manifests", () => {
    expect(dumpScript).toContain('"postgres:17"');
    expect(dumpScript).toContain("encryptedHmacSha256");
    expect(dumpScript).toContain("sourceCounts");
    expect(restoreScript).toContain("AUTHENTICATED_DUMP_MANIFEST_REQUIRED");
    expect(restoreScript).toContain("POSTGRES_17_IMAGE_REQUIRED");
  });

  it("streams decryption directly to pg_restore and always removes its unique container", () => {
    expect(restoreScript).toContain("decrypt.stdout.pipe(restore.stdin)");
    expect(restoreScript).toContain("randomBytes(6)");
    expect(restoreScript).toContain('docker(["rm", "--force", container])');
    expect(restoreScript).toContain("plaintextDumpAtRest: false");
  });

  it("compares restored row counts and rejects invalid constraints", () => {
    expect(restoreScript).toContain("DISPOSABLE_RESTORE_ROW_COUNT_MISMATCH");
    expect(restoreScript).toContain("UNVALIDATED_CONSTRAINTS_FOUND");
  });
});
