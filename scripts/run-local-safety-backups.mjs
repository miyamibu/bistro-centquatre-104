import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function createTimestampLabel(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function run(cmd, args, cwd) {
  const result = await execFileAsync(cmd, args, {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.stdout.trim()) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr.trim()) {
    process.stderr.write(result.stderr);
  }

  return result;
}

async function runRequiredStep(label, cmd, args, cwd) {
  try {
    await run(cmd, args, cwd);
    return null;
  } catch (error) {
    if (error && typeof error === "object") {
      if ("stdout" in error && typeof error.stdout === "string" && error.stdout.trim()) {
        process.stdout.write(error.stdout);
      }
      if ("stderr" in error && typeof error.stderr === "string" && error.stderr.trim()) {
        process.stderr.write(error.stderr);
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workspace:snapshot] ${label} が失敗しました: ${message}`);
    return new Error(`${label}: ${message}`);
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
  const workspaceSnapshotDir = path.join(cwd, "backups", "workspace-snapshots");

  await fs.mkdir(workspaceSnapshotDir, { recursive: true, mode: 0o700 });
  await fs.chmod(workspaceSnapshotDir, 0o700);

  const failures = [];
  const reservationBackupError = await runRequiredStep(
    "reservation backup",
    "npm",
    ["run", "backup:reservations:run"],
    cwd
  );
  if (reservationBackupError) {
    failures.push(reservationBackupError);
  }

  if (!(await hasGitHead(cwd))) {
    console.warn("[workspace:snapshot] Git HEAD が無いため bundle 作成をスキップしました");
    if (failures.length > 0) {
      throw new Error(failures.map((failure) => failure.message).join("; "));
    }
    return;
  }

  const bundlePath = path.join(
    workspaceSnapshotDir,
    `workspace-${createTimestampLabel()}.bundle`
  );
  const latestBundlePath = path.join(workspaceSnapshotDir, "latest.bundle");

  const bundleError = await runRequiredStep(
    "workspace bundle",
    "git",
    ["bundle", "create", bundlePath, "--all"],
    cwd
  );
  if (bundleError) {
    failures.push(bundleError);
  } else {
    await fs.copyFile(bundlePath, latestBundlePath);
    await fs.chmod(bundlePath, 0o600);
    await fs.chmod(latestBundlePath, 0o600);

    console.info(`[workspace:snapshot] bundle を更新しました: ${bundlePath}`);
  }

  if (failures.length > 0) {
    throw new Error(failures.map((failure) => failure.message).join("; "));
  }
}

main().catch((error) => {
  console.error(
    `[workspace:snapshot] 失敗: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
