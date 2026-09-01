import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { computeReservationBackupChecksum } from "../src/lib/reservation-backup-checksum.mjs";

const execFileAsync = promisify(execFile);

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

function emptyExport() {
  const payload = {
    schemaVersion: 4 as const,
    generatedAt: "2026-08-26T00:00:00.000Z",
    range: { from: "2026-08-26", to: "2026-08-26", days: 1 },
    counts: {
      businessDays: 0,
      reservations: 0,
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
    businessDays: [],
    businessDayAuditLogs: [],
    reservations: [],
    privateBlockAuditLogs: [],
    reservationStatusAuditLogs: [],
    reservationCorrectionAuditLogs: [],
    reservationEmailOutbox: [],
    reservationLineLinkTokens: [],
    reservationManagementTokens: [],
    reservationIdempotencyRecords: [],
    notificationEvents: [],
    requestId: "checksum-pull-test",
    maxExportRangeDays: 31,
  };
  return { ...payload, checksumSha256: computeReservationBackupChecksum(payload) };
}

async function runPull(payload: ReturnType<typeof emptyExport>) {
  const server = http.createServer((request, response) => {
    expect(request.headers.authorization).toBe("Bearer pull-test-secret");
    expect(request.headers["x-backup-export-secret"]).toBe("pull-test-secret");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  const port = await listen(server);
  try {
    return await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/pull-reservation-backups.ts",
        `--base-url=http://127.0.0.1:${port}`,
        "--from=2026-08-26",
        "--to=2026-08-26",
        "--dry-run=true",
      ],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          BACKUP_EXPORT_SECRET: "pull-test-secret",
        },
      },
    );
  } finally {
    await close(server);
  }
}

describe("daily reservation backup pull checksum", () => {
  it("accepts a response whose canonical checksum matches", async () => {
    await expect(runPull(emptyExport())).resolves.toMatchObject({ stderr: "" });
  });

  it("fails closed when the response checksum does not match", async () => {
    const payload = emptyExport();
    payload.checksumSha256 = "a".repeat(64);
    await expect(runPull(payload)).rejects.toMatchObject({ code: 1 });
  });
});
