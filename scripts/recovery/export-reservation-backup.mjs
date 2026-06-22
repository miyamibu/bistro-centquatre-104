#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";

const DEFAULT_ROUTE_PATH = "/api/admin/backups/reservations/export";

function parseCliArgs(argv) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const normalized = token.slice(2);
    const equalIndex = normalized.indexOf("=");
    if (equalIndex >= 0) {
      args.set(normalized.slice(0, equalIndex), normalized.slice(equalIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(normalized, "true");
      continue;
    }

    args.set(normalized, next);
    index += 1;
  }

  return args;
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  const contents = readFileSync(filePath, "utf8");
  const env = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function mergedEnv(cwd) {
  return {
    ...parseEnvFile(path.join(cwd, ".env")),
    ...parseEnvFile(path.join(cwd, ".env.local")),
    ...process.env,
  };
}

function normalizeBaseUrl(rawBaseUrl) {
  const parsed = new URL(rawBaseUrl);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

function buildQuery(args, now) {
  const from = args.get("from");
  const to = args.get("to");
  const date = args.get("date");

  if ((from && !to) || (!from && to)) {
    throw new Error("--from と --to は両方指定してください");
  }

  if (date && (from || to)) {
    throw new Error("--date と --from/--to は同時に指定できません");
  }

  if (date) {
    return { date };
  }

  if (from && to) {
    return { from, to };
  }

  const todayJst = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  return { date: todayJst };
}

function resolveOutputDir(cwd, args, env) {
  const preferred =
    args.get("out-dir") ??
    env.BISTRO_BACKUP_DIR ??
    env.BACKUP_OUTPUT_DIR ??
    path.resolve(cwd, "backups", "manual-export-backups");

  return path.isAbsolute(preferred) ? preferred : path.resolve(cwd, preferred);
}

function createTimestampLabel(now) {
  return now.toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const cwd = process.cwd();
  const args = parseCliArgs(process.argv.slice(2));
  const env = mergedEnv(cwd);
  const now = new Date();

  const baseUrlRaw = args.get("base-url") ?? env.BACKUP_BASE_URL ?? env.BASE_URL;
  if (!baseUrlRaw) {
    throw new Error("BACKUP_BASE_URL または BASE_URL を設定してください");
  }

  const backupSecret = args.get("secret") ?? env.BACKUP_EXPORT_SECRET;
  if (!backupSecret) {
    throw new Error("BACKUP_EXPORT_SECRET を設定してください。CRON_SECRET はバックアップ認証に使用しません");
  }

  const routePath = args.get("route-path") ?? DEFAULT_ROUTE_PATH;
  const query = buildQuery(args, now);
  const outputDir = resolveOutputDir(cwd, args, env);
  const dryRun = args.get("dry-run") === "true";

  const adminUser = (args.get("admin-user") ?? env.ADMIN_BASIC_USER ?? "").trim();
  const adminPass = (args.get("admin-pass") ?? env.ADMIN_BASIC_PASS ?? "").trim();

  if ((adminUser && !adminPass) || (!adminUser && adminPass)) {
    throw new Error("ADMIN_BASIC_USER / ADMIN_BASIC_PASS は両方指定してください");
  }

  const needsBasicAuth = routePath.startsWith("/api/admin");
  if (needsBasicAuth && (!adminUser || !adminPass)) {
    throw new Error("/api/admin バックアップには ADMIN_BASIC_USER / ADMIN_BASIC_PASS が必要です");
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrlRaw);
  const requestUrl = new URL(routePath.startsWith("/") ? routePath : `/${routePath}`, `${normalizedBaseUrl}/`);
  if (query.date) {
    requestUrl.searchParams.set("date", query.date);
  }
  if (query.from && query.to) {
    requestUrl.searchParams.set("from", query.from);
    requestUrl.searchParams.set("to", query.to);
  }

  const headers = {
    accept: "application/json",
    "x-backup-export-secret": backupSecret,
  };

  if (adminUser && adminPass) {
    headers.authorization = `Basic ${Buffer.from(`${adminUser}:${adminPass}`).toString("base64")}`;
  } else {
    headers.authorization = `Bearer ${backupSecret}`;
  }

  const response = await fetch(requestUrl, {
    method: "GET",
    headers,
  });

  const raw = await response.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error("バックアップAPIの応答がJSONではありません");
  }

  if (!response.ok) {
    const apiError =
      typeof json === "object" && json && "error" in json
        ? String(json.error)
        : `status=${response.status}`;
    throw new Error(`バックアップAPIエラー: ${apiError}`);
  }

  const counts = json?.counts;
  if (!counts || typeof counts !== "object") {
    throw new Error("バックアップAPI応答に counts が存在しません");
  }

  const reservations = Number(counts.reservations ?? 0);
  const businessDays = Number(counts.businessDays ?? 0);
  const privateBlockAuditLogs = Number(counts.privateBlockAuditLogs ?? 0);

  const runAt = now.toISOString();
  const backupFileName = `reservations-${createTimestampLabel(now)}.json`;
  const backupFilePath = path.join(outputDir, backupFileName);
  const latestRunPath = path.join(outputDir, "latest-run.json");

  if (!dryRun) {
    await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
    await fs.chmod(outputDir, 0o700);

    const exportPayload = {
      schemaVersion: 1,
      exportedAt: runAt,
      counts: {
        reservations,
        businessDays,
        privateBlockAuditLogs,
      },
      payload: json,
    };

    await fs.writeFile(backupFilePath, `${JSON.stringify(exportPayload, null, 2)}\n`, "utf8");
    await fs.chmod(backupFilePath, 0o600);

    const latestRun = {
      schemaVersion: 1,
      runAt,
      backupFile: backupFilePath,
      counts: {
        reservations,
        businessDays,
        privateBlockAuditLogs,
      },
      dryRun: false,
    };

    await fs.writeFile(latestRunPath, `${JSON.stringify(latestRun, null, 2)}\n`, "utf8");
    await fs.chmod(latestRunPath, 0o600);
  }

  const destination = dryRun ? outputDir : backupFilePath;
  console.info(
    `[backup:reservations] reservations=${reservations} businessDays=${businessDays} auditLogs=${privateBlockAuditLogs} saved=${destination} runAt=${runAt}${dryRun ? " (dry-run)" : ""}`
  );
}

main().catch((error) => {
  console.error(`[backup:reservations] 失敗: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
