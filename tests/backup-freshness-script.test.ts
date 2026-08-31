import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeBackupDir(pulledAt: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bistro-backup-status-"));
  tempDirs.push(dir);
  const encryptedContents = "test encrypted backup payload\n";
  await fs.mkdir(path.join(dir, "days"));
  await fs.writeFile(path.join(dir, "days", "2026-06-01.json.enc"), encryptedContents, "utf8");
  await fs.chmod(path.join(dir, "days", "2026-06-01.json.enc"), 0o600);
  await fs.writeFile(
    path.join(dir, "latest-run.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        pulledAt,
        dryRun: false,
        encryption: { format: "bistro-backup", encryptionVersion: 2, algorithm: "aes-256-gcm" },
        config: {
          baseUrl: "https://example.com",
          routePath: "/api/admin/backups/reservations/export",
          from: "2026-06-01",
          to: "2026-06-30",
          chunkCount: 1,
        },
        totals: {
          dayFilesWritten: 30,
          reservations: 2,
          businessDays: 1,
          privateBlockAuditLogs: 0,
        },
        chunks: [
          {
            from: "2026-06-01",
            to: "2026-06-30",
            checksumSha256: "a".repeat(64),
            counts: { reservations: 2, businessDays: 1, privateBlockAuditLogs: 0 },
          },
        ],
        encryptedDayFiles: [
          {
            date: "2026-06-01",
            path: "days/2026-06-01.json.enc",
            sha256: createHash("sha256").update(encryptedContents).digest("hex"),
          },
        ],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.chmod(path.join(dir, "latest-run.json"), 0o600);
  return dir;
}

describe("check-reservation-backup-freshness", () => {
  it("prints a PII-free freshness manifest for a fresh backup", async () => {
    const dir = await makeBackupDir(new Date().toISOString());
    const result = await execFileAsync(
      "node",
      [
        "--import",
        "tsx",
        "scripts/check-reservation-backup-freshness.ts",
        `--out-dir=${dir}`,
        "--max-age-hours=36",
      ],
      { cwd: process.cwd() }
    );

    const manifest = JSON.parse(result.stdout) as {
      status: string;
      totals: { reservations: number };
      chunkChecksums: Array<{ checksumSha256: string }>;
    };
    expect(manifest.status).toBe("FRESH");
    expect(manifest.totals.reservations).toBe(2);
    expect(manifest.chunkChecksums[0].checksumSha256).toBe("a".repeat(64));
    expect(result.stdout).not.toMatch(/(?:^|[^\d])090[-\s]?\d{4}[-\s]?\d{4}(?:$|[^\d])/);
    expect(result.stdout).not.toContain("customer@example.com");
  });

  it("exits non-zero for a stale backup", async () => {
    const stale = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const dir = await makeBackupDir(stale);

    await expect(
      execFileAsync(
        "node",
        [
          "--import",
          "tsx",
          "scripts/check-reservation-backup-freshness.ts",
          `--out-dir=${dir}`,
          "--max-age-hours=36",
        ],
        { cwd: process.cwd() }
      )
    ).rejects.toMatchObject({ code: 1 });
  });

  it("uses the newest timestamped run instead of a stale latest-run.json", async () => {
    const dir = await makeBackupDir(new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString());
    const runDir = path.join(dir, "runs");
    await fs.mkdir(runDir);
    const latest = JSON.parse(await fs.readFile(path.join(dir, "latest-run.json"), "utf8"));
    latest.pulledAt = new Date().toISOString();
    await fs.writeFile(path.join(runDir, "pull-current.json"), `${JSON.stringify(latest)}\n`);

    const result = await execFileAsync(
      "node",
      ["--import", "tsx", "scripts/check-reservation-backup-freshness.ts", `--out-dir=${dir}`, "--max-age-hours=36"],
      { cwd: process.cwd() },
    );
    expect(JSON.parse(result.stdout).status).toBe("FRESH");
  });

  it("fails closed when an encrypted day file checksum no longer matches", async () => {
    const dir = await makeBackupDir(new Date().toISOString());
    await fs.appendFile(path.join(dir, "days", "2026-06-01.json.enc"), "tampered");
    await expect(
      execFileAsync(
        "node",
        ["--import", "tsx", "scripts/check-reservation-backup-freshness.ts", `--out-dir=${dir}`, "--max-age-hours=36"],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({ code: 1 });
  });
});
