import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function getDefaultBackupOutputDir() {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "bistro-reservation",
      "backups",
      "reservation-status"
    );
  }

  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "bistro-reservation", "backups", "reservation-status");
  }

  const dataHome =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "bistro-reservation", "backups", "reservation-status");
}

function createTimestampLabel(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function run(cmd, args, cwd) {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (stdout.trim()) {
    process.stdout.write(stdout);
  }
  if (stderr.trim()) {
    process.stderr.write(stderr);
  }
}

async function hasGitHead(cwd) {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const cwd = process.cwd();
  const backupOutputDir = process.env.BACKUP_OUTPUT_DIR || getDefaultBackupOutputDir();
  const workspaceSnapshotDir = path.resolve(backupOutputDir, "..", "..", "workspace-snapshots");

  await fs.mkdir(workspaceSnapshotDir, { recursive: true, mode: 0o700 });
  await fs.chmod(workspaceSnapshotDir, 0o700);

  await run("npm", ["run", "backup:reservations:run"], cwd);

  if (!(await hasGitHead(cwd))) {
    console.warn("[workspace:snapshot] Git HEAD が無いため bundle 作成をスキップしました");
    return;
  }

  const bundlePath = path.join(
    workspaceSnapshotDir,
    `workspace-${createTimestampLabel()}.bundle`
  );
  const latestBundlePath = path.join(workspaceSnapshotDir, "latest.bundle");

  await run("git", ["bundle", "create", bundlePath, "--all"], cwd);
  await fs.copyFile(bundlePath, latestBundlePath);
  await fs.chmod(bundlePath, 0o600);
  await fs.chmod(latestBundlePath, 0o600);

  console.info(`[workspace:snapshot] bundle を更新しました: ${bundlePath}`);
}

main().catch((error) => {
  console.error(
    `[workspace:snapshot] 失敗: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
