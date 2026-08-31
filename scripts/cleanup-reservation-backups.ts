import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  DATE_PATTERN,
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  addDaysUtc,
  formatDateUtc,
  getTodayJstDateString,
  loadMergedEnv,
  parseCliArgs,
  parseDateStrict,
  parsePositiveInt,
  readOption,
  resolveOutputDir,
} from "./reservation-backup-common";

const APPLY_CONFIRMATION_TOKEN = "archive-reservation-backups";
const CLEANUP_ENABLED_ENV = "BACKUP_CLEANUP_ENABLED";

async function ensureDirectory(targetPath: string) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function archiveFile(
  targetPath: string,
  archiveDir: string,
  dryRun: boolean,
  label: string
) {
  const archivePath = path.join(archiveDir, path.basename(targetPath));
  if (dryRun) {
    console.info(`[backup:cleanup] dry-run archive ${label}: ${targetPath} -> ${archivePath}`);
    return;
  }

  await ensureDirectory(archiveDir);
  await fs.rename(targetPath, archivePath);
}

async function cleanupDayFiles(
  daysDir: string,
  archiveDaysDir: string,
  cutoffDate: string,
  dryRun: boolean
) {
  let checked = 0;
  let archived = 0;
  let skipped = 0;

  const entries = await fs.readdir(daysDir, { withFileTypes: true });
  for (const entry of entries) {
    // New backups are encrypted. Existing plaintext files are legacy evidence
    // and must remain untouched by this retention job.
    if (!entry.isFile() || !entry.name.endsWith(".json.enc")) {
      continue;
    }

    checked += 1;
    const dateText = entry.name.replace(/\.json\.enc$/i, "");
    if (!DATE_PATTERN.test(dateText)) {
      skipped += 1;
      continue;
    }

    try {
      parseDateStrict(dateText, entry.name);
    } catch {
      skipped += 1;
      continue;
    }

    if (dateText >= cutoffDate) {
      continue;
    }

    const targetPath = path.join(daysDir, entry.name);
    await archiveFile(targetPath, archiveDaysDir, dryRun, "day");
    archived += 1;
  }

  return { checked, archived, skipped };
}

async function cleanupRunFiles(
  runsDir: string,
  archiveRunsDir: string,
  cutoffTimeMs: number,
  dryRun: boolean
) {
  let checked = 0;
  let archived = 0;

  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith("pull-") || !entry.name.endsWith(".json")) {
      continue;
    }

    // Legacy plaintext run summaries are recovery evidence and must remain
    // untouched. Only the new metadata format is eligible for archiving.
    try {
      const summary = JSON.parse(await fs.readFile(path.join(runsDir, entry.name), "utf8"));
      if (
        ![2, 3].includes(summary?.schemaVersion) ||
        summary?.encryption?.format !== "bistro-reservation-backup-aead"
      ) {
        continue;
      }
    } catch {
      continue;
    }

    checked += 1;
    const targetPath = path.join(runsDir, entry.name);
    const stats = await fs.stat(targetPath);
    if (stats.mtimeMs >= cutoffTimeMs) {
      continue;
    }

    await archiveFile(targetPath, archiveRunsDir, dryRun, "run");
    archived += 1;
  }

  return { checked, archived };
}

async function directoryExists(targetPath: string) {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  const cwd = process.cwd();
  const cli = parseCliArgs(process.argv.slice(2));
  const env = loadMergedEnv(cwd);
  const apply = readOption(cli, "apply") === "true";
  const dryRun = readOption(cli, "dry-run") !== "false" && !apply;
  const confirmation = readOption(cli, "confirm-safe-target");
  const cleanupEnabled = env[CLEANUP_ENABLED_ENV] === "true";

  if (!cleanupEnabled) {
    console.info(
      `[backup:cleanup] クリーンアップは現在無効です（${CLEANUP_ENABLED_ENV}=true を設定すると有効化）`
    );
    return;
  }

  const outputDir = resolveOutputDir(cwd, readOption(cli, "out-dir") ?? env.BACKUP_OUTPUT_DIR);
  const retentionDays = parsePositiveInt(
    readOption(cli, "retention-days") ?? env.BACKUP_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
    "--retention-days"
  );

  if (retentionDays < MIN_RETENTION_DAYS) {
    throw new Error(
      `保持期間は ${MIN_RETENTION_DAYS} 日以上で指定してください（現在: ${retentionDays} 日）`
    );
  }

  const todayRaw = readOption(cli, "today") ?? getTodayJstDateString();
  const today = parseDateStrict(todayRaw, "--today");
  const cutoff = addDaysUtc(today, -retentionDays);
  const cutoffDate = formatDateUtc(cutoff);
  const cutoffTimeMs = cutoff.getTime();

  const daysDir = path.join(outputDir, "days");
  const runsDir = path.join(outputDir, "runs");
  const archiveRoot = path.join(outputDir, "archive");
  const archiveDaysDir = path.join(archiveRoot, "days");
  const archiveRunsDir = path.join(archiveRoot, "runs");

  if (!dryRun && confirmation !== APPLY_CONFIRMATION_TOKEN) {
    throw new Error(
      `アーカイブ適用には --apply=true --confirm-safe-target=${APPLY_CONFIRMATION_TOKEN} が必要です`
    );
  }

  if (!(await directoryExists(daysDir))) {
    console.info(`[backup:cleanup] 対象ディレクトリが存在しません: ${daysDir}`);
    return;
  }

  const dayResult = await cleanupDayFiles(daysDir, archiveDaysDir, cutoffDate, dryRun);
  const runResult =
    (await directoryExists(runsDir)) &&
    (await cleanupRunFiles(runsDir, archiveRunsDir, cutoffTimeMs, dryRun));

  console.info(
    `[backup:cleanup] 完了 retention=${retentionDays}days cutoff=${cutoffDate} dayFiles checked=${dayResult.checked} archived=${dayResult.archived} skipped=${dayResult.skipped}${dryRun ? " (dry-run)" : ""}`
  );

  if (runResult) {
    console.info(
      `[backup:cleanup] runs checked=${runResult.checked} archived=${runResult.archived}${
        dryRun ? " (dry-run)" : ""
      }`
    );
  }
}

main().catch((error) => {
  console.error(`[backup:cleanup] 失敗: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
