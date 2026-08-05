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

async function cleanupDayFiles(daysDir: string, cutoffDate: string, dryRun: boolean) {
  let checked = 0;
  let deleted = 0;
  let skipped = 0;

  const entries = await fs.readdir(daysDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    checked += 1;
    const dateText = entry.name.replace(/\.json$/i, "");
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
    if (!dryRun) {
      await fs.unlink(targetPath);
    }
    deleted += 1;
  }

  return { checked, deleted, skipped };
}

async function cleanupRunFiles(runsDir: string, cutoffTimeMs: number, dryRun: boolean) {
  let checked = 0;
  let deleted = 0;

  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith("pull-") || !entry.name.endsWith(".json")) {
      continue;
    }

    checked += 1;
    const targetPath = path.join(runsDir, entry.name);
    const stats = await fs.stat(targetPath);
    if (stats.mtimeMs >= cutoffTimeMs) {
      continue;
    }

    if (!dryRun) {
      await fs.unlink(targetPath);
    }
    deleted += 1;
  }

  return { checked, deleted };
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
  const apply = readOption(cli, "apply") === "true" && env.BACKUP_CLEANUP_ENABLED === "true";
  const dryRun = !apply;

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

  if (!(await directoryExists(daysDir))) {
    console.info(`[backup:cleanup] 対象ディレクトリが存在しません: ${daysDir}`);
    return;
  }

  const dayResult = await cleanupDayFiles(daysDir, cutoffDate, dryRun);
  const runResult =
    (await directoryExists(runsDir)) && (await cleanupRunFiles(runsDir, cutoffTimeMs, dryRun));

  console.info(
    `[backup:cleanup] 完了 retention=${retentionDays}days cutoff=${cutoffDate} dayFiles checked=${dayResult.checked} deleted=${dayResult.deleted} skipped=${dayResult.skipped}${dryRun ? " (dry-run)" : ""}`
  );

  if (runResult) {
    console.info(
      `[backup:cleanup] runs checked=${runResult.checked} deleted=${runResult.deleted}${
        dryRun ? " (dry-run)" : ""
      }`
    );
  }
}

main().catch((error) => {
  console.error(`[backup:cleanup] 失敗: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
