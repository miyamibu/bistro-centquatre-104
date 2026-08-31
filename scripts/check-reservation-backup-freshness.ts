import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import {
  loadMergedEnv,
  parseCliArgs,
  parsePositiveInt,
  readOption,
  resolveOutputDir,
} from "./reservation-backup-common";

type BackupRunSummary = {
  schemaVersion: number;
  pulledAt: string;
  dryRun: boolean;
  encryption?: {
    format?: string;
    encryptionVersion?: number;
    algorithm?: string;
  } | null;
  config?: {
    baseUrl?: string;
    routePath?: string;
    from?: string;
    to?: string;
    chunkCount?: number;
  };
  totals?: {
    dayFilesWritten?: number;
    businessDays?: number;
    reservations?: number;
    privateBlockAuditLogs?: number;
    businessDayAuditLogs?: number;
    reservationStatusAuditLogs?: number;
    reservationCorrectionAuditLogs?: number;
    reservationEmailOutbox?: number;
    reservationLineLinkTokens?: number;
    notificationEvents?: number;
  };
  chunks?: Array<{
    from: string;
    to: string;
    checksumSha256: string;
    counts?: {
      reservations?: number;
      businessDays?: number;
      privateBlockAuditLogs?: number;
    };
  }>;
  encryptedDayFiles?: Array<{ date: string; path: string; sha256: string }>;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRunSummary(value: unknown): BackupRunSummary {
  if (!isObject(value)) {
    throw new Error("latest-run.json is not an object");
  }

  if (typeof value.schemaVersion !== "number") {
    throw new Error("latest-run.json schemaVersion is missing");
  }
  if (typeof value.pulledAt !== "string") {
    throw new Error("latest-run.json pulledAt is missing");
  }

  const pulledAtMs = Date.parse(value.pulledAt);
  if (!Number.isFinite(pulledAtMs)) {
    throw new Error("latest-run.json pulledAt is invalid");
  }

  return value as BackupRunSummary;
}

function modeOctal(mode: number) {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

async function readJson(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as unknown;
}

async function findFreshestRun(outputDir: string) {
  const candidates = [path.join(outputDir, "latest-run.json")];
  const runsDir = path.join(outputDir, "runs");
  try {
    const names = await fs.readdir(runsDir);
    candidates.push(...names.filter((name) => /^pull-.*\.json$/.test(name)).map((name) => path.join(runsDir, name)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const summaries = await Promise.all(candidates.map(async (filePath) => ({ filePath, summary: parseRunSummary(await readJson(filePath)) })));
  return summaries.reduce((freshest, candidate) => Date.parse(candidate.summary.pulledAt) > Date.parse(freshest.summary.pulledAt) ? candidate : freshest);
}

async function verifyEncryptedDayFiles(outputDir: string, run: BackupRunSummary) {
  if (!run.encryption?.format || !run.encryption.algorithm || !run.encryption.encryptionVersion) {
    return { verified: false, reason: "encryption metadata is missing", files: 0 };
  }
  if (!Array.isArray(run.encryptedDayFiles) || run.encryptedDayFiles.length === 0) {
    return { verified: false, reason: "encrypted day-file checksums are missing", files: 0 };
  }
  for (const entry of run.encryptedDayFiles) {
    if (!/^days\/\d{4}-\d{2}-\d{2}\.json\.enc$/.test(entry.path) || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      return { verified: false, reason: "encrypted day-file metadata is invalid", files: 0 };
    }
    const [contents, stats] = await Promise.all([fs.readFile(path.join(outputDir, entry.path)), fs.stat(path.join(outputDir, entry.path))]);
    if (createHash("sha256").update(contents).digest("hex") !== entry.sha256 || modeOctal(stats.mode) !== "600") {
      return { verified: false, reason: `encrypted day-file integrity check failed: ${entry.path}`, files: 0 };
    }
  }
  return { verified: true, reason: null, files: run.encryptedDayFiles.length };
}

async function main() {
  const cwd = process.cwd();
  const cli = parseCliArgs(process.argv.slice(2));
  const env = loadMergedEnv(cwd);
  const outputDir = resolveOutputDir(cwd, readOption(cli, "out-dir") ?? env.BACKUP_OUTPUT_DIR);
  const maxAgeHours = parsePositiveInt(
    readOption(cli, "max-age-hours") ?? env.BACKUP_FRESHNESS_MAX_AGE_HOURS,
    26,
    "--max-age-hours"
  );

  const { filePath: latestRunPath, summary: latestRun } = await findFreshestRun(outputDir);
  const latestStats = await fs.stat(latestRunPath);
  const outputStats = await fs.stat(outputDir);
  const pulledAtMs = Date.parse(latestRun.pulledAt);
  const checkedAt = new Date();
  const ageHours = (checkedAt.getTime() - pulledAtMs) / (60 * 60 * 1000);
  const integrity = await verifyEncryptedDayFiles(outputDir, latestRun);
  const fresh = ageHours <= maxAgeHours && !latestRun.dryRun && integrity.verified;

  const manifest = {
    schemaVersion: 1,
    checkedAt: checkedAt.toISOString(),
    status: fresh ? "FRESH" : integrity.verified ? "STALE" : "UNVERIFIABLE",
    freshness: {
      latestPulledAt: latestRun.pulledAt,
      ageHours: Number(ageHours.toFixed(2)),
      maxAgeHours,
      dryRun: latestRun.dryRun,
    },
    storage: {
      outputDir,
      outputDirMode: modeOctal(outputStats.mode),
      latestRunPath,
      latestRunMode: modeOctal(latestStats.mode),
    },
    source: {
      baseUrl: latestRun.config?.baseUrl ?? null,
      routePath: latestRun.config?.routePath ?? null,
    },
    encryption: latestRun.encryption ?? null,
    integrity,
    coverage: {
      from: latestRun.config?.from ?? null,
      to: latestRun.config?.to ?? null,
      chunkCount: latestRun.config?.chunkCount ?? latestRun.chunks?.length ?? 0,
    },
    totals: {
      dayFilesWritten: latestRun.totals?.dayFilesWritten ?? 0,
      reservations: latestRun.totals?.reservations ?? 0,
      businessDays: latestRun.totals?.businessDays ?? 0,
      privateBlockAuditLogs: latestRun.totals?.privateBlockAuditLogs ?? 0,
      businessDayAuditLogs: latestRun.totals?.businessDayAuditLogs ?? 0,
      reservationStatusAuditLogs: latestRun.totals?.reservationStatusAuditLogs ?? 0,
      reservationCorrectionAuditLogs: latestRun.totals?.reservationCorrectionAuditLogs ?? 0,
      reservationEmailOutbox: latestRun.totals?.reservationEmailOutbox ?? 0,
      reservationLineLinkTokens: latestRun.totals?.reservationLineLinkTokens ?? 0,
      notificationEvents: latestRun.totals?.notificationEvents ?? 0,
    },
    chunkChecksums: (latestRun.chunks ?? []).map((chunk) => ({
      from: chunk.from,
      to: chunk.to,
      checksumSha256: chunk.checksumSha256,
      counts: chunk.counts ?? null,
    })),
  };

  console.info(JSON.stringify(manifest, null, 2));

  if (!fresh) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    `[backup:status] 失敗: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
