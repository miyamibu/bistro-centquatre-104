import fs from "node:fs/promises";
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

  const latestRunPath = path.join(outputDir, "latest-run.json");
  const latestRun = parseRunSummary(await readJson(latestRunPath));
  const latestStats = await fs.stat(latestRunPath);
  const outputStats = await fs.stat(outputDir);
  const pulledAtMs = Date.parse(latestRun.pulledAt);
  const checkedAt = new Date();
  const ageHours = (checkedAt.getTime() - pulledAtMs) / (60 * 60 * 1000);
  const fresh = ageHours <= maxAgeHours && !latestRun.dryRun;

  const manifest = {
    schemaVersion: 1,
    checkedAt: checkedAt.toISOString(),
    status: fresh ? "FRESH" : "STALE",
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
