#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  BACKUP_ENCRYPTION_ALGORITHM,
  BACKUP_ENCRYPTION_FORMAT,
  BACKUP_ENCRYPTION_VERSION,
  encryptBackupPayload,
  resolveBackupEncryptionConfig,
} from "../backup-encryption.mjs";

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

function readCount(counts, key) {
  const value = counts?.[key];
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`バックアップAPI応答のcounts.${key}が不正です`);
  }
  return value;
}

function sanitizeExportPayload(exported) {
  if (!Array.isArray(exported.reservationEmailOutbox)) {
    throw new Error("バックアップAPI応答のreservationEmailOutboxが配列ではありません");
  }

  return {
    ...exported,
    reservationEmailOutbox: exported.reservationEmailOutbox.map((row) => {
      const sanitized = { ...row };
      delete sanitized.claimToken;
      delete sanitized.claim_token;
      return sanitized;
    }),
  };
}

async function main() {
  const cwd = process.cwd();
  const args = parseCliArgs(process.argv.slice(2));
  const now = new Date();

  for (const option of ["secret", "admin-pass", "admin-user"]) {
    if (args.has(option)) {
      throw new Error(`--${option} は使用できません。認証情報は環境変数で設定してください`);
    }
  }

  const env = mergedEnv(cwd);

  const baseUrlRaw = args.get("base-url") ?? env.BACKUP_BASE_URL ?? env.BASE_URL;
  if (!baseUrlRaw) {
    throw new Error("BACKUP_BASE_URL または BASE_URL を設定してください");
  }

  const backupSecret = env.BACKUP_EXPORT_SECRET?.trim();
  if (!backupSecret) {
    throw new Error(
      "BACKUP_EXPORT_SECRET を環境変数で設定してください。CRON_SECRET はバックアップ認証に使用しません"
    );
  }

  const routePath = args.get("route-path") ?? DEFAULT_ROUTE_PATH;
  const query = buildQuery(args, now);
  const outputDir = resolveOutputDir(cwd, args, env);
  const dryRun = args.get("dry-run") === "true";

  const encryptionConfig = dryRun
    ? null
    : await resolveBackupEncryptionConfig({
        environment: env,
        readFromStdin: args.get("encryption-key-stdin") === "true",
      });

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

  headers.authorization = `Bearer ${backupSecret}`;

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

  if (!json || typeof json !== "object" || json.schemaVersion !== 2) {
    throw new Error("バックアップAPI応答のschemaVersionが未対応です");
  }

  const counts = json.counts;
  if (!counts || typeof counts !== "object") {
    throw new Error("バックアップAPI応答に counts が存在しません");
  }

  if (typeof json.checksumSha256 !== "string" || !/^[0-9a-f]{64}$/.test(json.checksumSha256)) {
    throw new Error("バックアップAPI応答のchecksumSha256が不正です");
  }

  const reservations = readCount(counts, "reservations");
  const businessDays = readCount(counts, "businessDays");
  const privateBlockAuditLogs = readCount(counts, "privateBlockAuditLogs");
  const reservationStatusAuditLogs = readCount(counts, "reservationStatusAuditLogs");
  const reservationEmailOutbox = readCount(counts, "reservationEmailOutbox");
  const reservationLineLinkTokens = readCount(counts, "reservationLineLinkTokens");
  const notificationEvents = readCount(counts, "notificationEvents");
  for (const [key, expectedCount] of [
    ["businessDays", businessDays],
    ["reservations", reservations],
    ["privateBlockAuditLogs", privateBlockAuditLogs],
    ["reservationStatusAuditLogs", reservationStatusAuditLogs],
    ["reservationEmailOutbox", reservationEmailOutbox],
    ["reservationLineLinkTokens", reservationLineLinkTokens],
    ["notificationEvents", notificationEvents],
  ]) {
    if (!Array.isArray(json[key]) || json[key].length !== expectedCount) {
      throw new Error(`バックアップAPI応答の${key}がcountsと一致しません`);
    }
  }
  const sanitizedPayload = sanitizeExportPayload(json);

  const runAt = now.toISOString();
  const backupFileName = `reservations-${createTimestampLabel(now)}.json.enc`;
  const backupFilePath = path.join(outputDir, backupFileName);
  const latestRunPath = path.join(outputDir, "latest-run.json");

  if (!dryRun) {
    await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
    await fs.chmod(outputDir, 0o700);

    const exportPayload = {
      ...sanitizedPayload,
      schemaVersion: 2,
      exportedAt: runAt,
      counts: {
        reservations,
        businessDays,
        privateBlockAuditLogs,
        reservationStatusAuditLogs,
        reservationEmailOutbox,
        reservationLineLinkTokens,
        notificationEvents,
      },
    };

    const encrypted = encryptBackupPayload(exportPayload, encryptionConfig.secret, {
      keyId: encryptionConfig.keyId,
    });
    await fs.writeFile(backupFilePath, `${encrypted}\n`, "utf8");
    await fs.chmod(backupFilePath, 0o600);
    const encryptedFileSha256 = createHash("sha256").update(encrypted).digest("hex");

    const latestRun = {
      schemaVersion: 2,
      runAt,
      backupFile: backupFilePath,
      payloadSchemaVersion: json.schemaVersion,
      checksumSha256: json.checksumSha256,
      encryptedFileSha256,
      encryption: {
        format: BACKUP_ENCRYPTION_FORMAT,
        encryptionVersion: BACKUP_ENCRYPTION_VERSION,
        algorithm: BACKUP_ENCRYPTION_ALGORITHM,
        keyId: encryptionConfig.keyId,
      },
      counts: {
        reservations,
        businessDays,
        privateBlockAuditLogs,
        reservationStatusAuditLogs,
        reservationEmailOutbox,
        reservationLineLinkTokens,
        notificationEvents,
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
