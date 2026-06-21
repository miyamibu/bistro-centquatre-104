#!/usr/bin/env node

import process from "node:process";
import { ALLOWLIST, scanWorkspace } from "./destructive-reservation-scanner.mjs";

const { files, violations } = scanWorkspace(process.cwd());

if (violations.length > 0) {
  console.error("[security:destructive] Reservation 物理削除の危険パターンを検出しました");
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} (${violation.rule})`);
  }
  process.exit(1);
}

console.info(`[security:destructive] OK (${files.length} files scanned, allowlist=${ALLOWLIST.size})`);
