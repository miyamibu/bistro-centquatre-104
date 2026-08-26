import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function listen(server: http.Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("test server address unavailable"));
      resolve(address.port);
    });
  });
}

function close(server: http.Server) {
  return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe("reservation backup export script", () => {
  it("hashes the exact encrypted file bytes and preserves schema-v4 recovery state", async () => {
    const payload = {
      schemaVersion: 4,
      generatedAt: "2026-08-26T00:00:00.000Z",
      range: { from: "2026-08-26", to: "2026-08-26" },
      checksumSha256: "a".repeat(64),
      counts: {
        reservations: 0,
        businessDays: 0,
        privateBlockAuditLogs: 0,
        businessDayAuditLogs: 0,
        reservationStatusAuditLogs: 0,
        reservationCorrectionAuditLogs: 0,
        reservationEmailOutbox: 0,
        reservationLineLinkTokens: 0,
        reservationManagementTokens: 0,
        reservationIdempotencyRecords: 0,
        notificationEvents: 0,
      },
      reservations: [],
      businessDays: [],
      privateBlockAuditLogs: [],
      businessDayAuditLogs: [],
      reservationStatusAuditLogs: [],
      reservationCorrectionAuditLogs: [],
      reservationEmailOutbox: [],
      reservationLineLinkTokens: [],
      reservationManagementTokens: [],
      reservationIdempotencyRecords: [],
      notificationEvents: [],
    };
    const server = http.createServer((request, response) => {
      expect(request.headers.authorization).toBe("Bearer test-backup-export-secret");
      expect(request.headers["x-backup-export-secret"]).toBe("test-backup-export-secret");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });
    const port = await listen(server);
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bistro-backup-export-test-"));
    tempDirs.push(cwd);
    const outputDir = path.join(cwd, "output");
    const script = path.resolve(process.cwd(), "scripts/recovery/export-reservation-backup.mjs");

    try {
      await execFileAsync(
        process.execPath,
        [script, `--base-url=http://127.0.0.1:${port}`, `--out-dir=${outputDir}`, "--date=2026-08-26"],
        {
          cwd,
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "test",
            BACKUP_EXPORT_SECRET: "test-backup-export-secret",
            BACKUP_ENCRYPTION_KEYS_JSON: JSON.stringify({ v4test: "k".repeat(32) }),
            BACKUP_ENCRYPTION_ACTIVE_KEY_ID: "v4test",
          },
        },
      );
    } finally {
      await close(server);
    }

    const manifest = JSON.parse(await fs.readFile(path.join(outputDir, "latest-run.json"), "utf8")) as {
      schemaVersion: number;
      backupFile: string;
      encryptedFileSha256: string;
      counts: Record<string, number>;
    };
    const encryptedBytes = await fs.readFile(manifest.backupFile);

    expect(manifest.schemaVersion).toBe(4);
    expect(manifest.counts).toMatchObject({
      reservationManagementTokens: 0,
      reservationIdempotencyRecords: 0,
    });
    expect(createHash("sha256").update(encryptedBytes).digest("hex")).toBe(manifest.encryptedFileSha256);
    expect(encryptedBytes.at(-1)).toBe(0x0a);
  });
});
