#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const envLocalPath = path.join(cwd, ".env.local");

let hasFailure = false;

function fail(message) {
  hasFailure = true;
  console.error(`[security:env] ${message}`);
}

function info(message) {
  console.info(`[security:env] ${message}`);
}

if (fs.existsSync(envLocalPath)) {
  const stats = fs.statSync(envLocalPath);
  const mode = stats.mode & 0o777;

  if (mode !== 0o600) {
    fail(`.env.local の権限が安全ではありません (current=${mode.toString(8)} expected=600)`);
  } else {
    info(".env.local の権限は 600 です");
  }
} else {
  info(".env.local が存在しないため権限チェックをスキップしました");
}

if (fs.existsSync(path.join(cwd, ".git"))) {
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", ".env.local"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (tracked.status === 0) {
    fail(".env.local が Git 管理対象です。`git rm --cached .env.local` で除外してください");
  } else {
    info(".env.local は Git 管理対象ではありません");
  }
} else {
  info(".git が見つからないため Git 追跡チェックをスキップしました");
}

if (hasFailure) {
  process.exit(1);
}

info("チェックを完了しました");
