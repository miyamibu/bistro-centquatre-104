import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { encryptBackupPayload } from "../scripts/backup-encryption.mjs";
import {
  computeReservationBackupChecksum,
  computeReservationDayBackupChecksum,
  reservationBackupChecksumMatches,
} from "../src/lib/reservation-backup-checksum.mjs";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const encryptionKey = "reservation-backup-checksum-test-key-32-characters";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function emptyPayload(schemaVersion: 2 | 3 | 4) {
  return {
    schemaVersion,
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
  };
}

describe("reservation backup canonical checksum", () => {
  it.each([2, 3, 4] as const)("preserves the historical schema-v%s canonical field set", (schemaVersion) => {
    const payload = emptyPayload(schemaVersion);
    const first = computeReservationBackupChecksum(payload);
    const historicalEmptyChecksums = {
      2: "2707204dac548bf9448b63ed2dc754c46c41c2822b4f7c927c99ccb3a206a1f9",
      3: "7bd1af997a10b1a4473315774e923451ef3516b05b3b5709e18c25c75e93da1b",
      4: "88fa3fb7d8578ba4e7d47fe8937250fcfc53e1264217298b94c7eee75464d5ae",
    } as const;
    const withTransportMetadata = {
      ...payload,
      generatedAt: "2099-01-01T00:00:00.000Z",
      requestId: "different-request",
      checksumSha256: "f".repeat(64),
    };

    expect(first).toBe(historicalEmptyChecksums[schemaVersion]);
    expect(computeReservationBackupChecksum(withTransportMetadata)).toBe(first);
    expect(reservationBackupChecksumMatches(withTransportMetadata, first)).toBe(true);
  });

  it("does not let fields introduced by later schemas change a legacy checksum", () => {
    const payload = emptyPayload(2);
    const before = computeReservationBackupChecksum(payload);
    payload.businessDayAuditLogs.push({ id: "ignored-by-v2" } as never);
    payload.counts.businessDayAuditLogs = 1;
    payload.reservationManagementTokens.push({ id: "ignored-by-v2" } as never);
    payload.counts.reservationManagementTokens = 1;
    expect(computeReservationBackupChecksum(payload)).toBe(before);
  });
});

describe("reservation backup restore checksum", () => {
  async function writeEncrypted(payload: unknown) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bistro-restore-checksum-"));
    tempDirs.push(dir);
    const file = path.join(dir, "backup.json.enc");
    await fs.writeFile(file, `${encryptBackupPayload(payload, encryptionKey)}\n`, "utf8");
    return file;
  }

  function runRestore(file: string) {
    return execFileAsync(process.execPath, ["scripts/backup-restore-drill.mjs", `--file=${file}`], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        BACKUP_ENCRYPTION_KEY: encryptionKey,
      },
    });
  }

  it("recalculates a new daily artifact checksum after decryption", async () => {
    const payload = {
      ...emptyPayload(4),
      date: "2026-08-26",
      businessDay: null,
    };
    delete (payload as Partial<typeof payload>).range;
    delete (payload as Partial<typeof payload>).businessDays;
    const contentChecksumSha256 = computeReservationDayBackupChecksum(payload);
    const file = await writeEncrypted({ ...payload, contentChecksumSha256 });

    await expect(runRestore(file)).resolves.toMatchObject({ stderr: "" });
  });

  it("fails closed when decrypted logical content no longer matches its checksum", async () => {
    const payload = {
      ...emptyPayload(4),
      date: "2026-08-26",
      businessDay: null,
    };
    delete (payload as Partial<typeof payload>).range;
    delete (payload as Partial<typeof payload>).businessDays;
    const contentChecksumSha256 = computeReservationDayBackupChecksum(payload);
    payload.counts.reservations = 1;
    payload.reservations.push({ id: "tampered" } as never);
    const file = await writeEncrypted({ ...payload, contentChecksumSha256 });

    await expect(runRestore(file)).rejects.toMatchObject({ code: 1 });
  });

  it("fails closed when a present logical checksum has the wrong type", async () => {
    const payload = {
      ...emptyPayload(4),
      date: "2026-08-26",
      businessDay: null,
      contentChecksumSha256: 123,
    };
    delete (payload as Partial<typeof payload>).range;
    delete (payload as Partial<typeof payload>).businessDays;
    const file = await writeEncrypted(payload);

    await expect(runRestore(file)).rejects.toMatchObject({ code: 1 });
  });

  it("keeps legacy daily artifacts without a local content checksum readable", async () => {
    const payload = {
      ...emptyPayload(4),
      date: "2026-08-26",
      businessDay: null,
    };
    delete (payload as Partial<typeof payload>).range;
    delete (payload as Partial<typeof payload>).businessDays;
    const file = await writeEncrypted(payload);

    await expect(runRestore(file)).resolves.toMatchObject({ stderr: "" });
  });

  it("recognizes a legacy schema-v2 API checksum inside a schema-v4 manual artifact", async () => {
    const sourcePayload = emptyPayload(2);
    const checksumSha256 = computeReservationBackupChecksum(sourcePayload);
    const legacyManualPayload = {
      ...sourcePayload,
      schemaVersion: 4,
      exportedAt: "2026-08-26T00:00:01.000Z",
      checksumSha256,
    };
    const file = await writeEncrypted(legacyManualPayload);

    await expect(runRestore(file)).resolves.toMatchObject({ stderr: "" });
  });
});
