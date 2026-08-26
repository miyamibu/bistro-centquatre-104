#!/usr/bin/env node

import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import {
  decryptBackupPayload,
  getBackupEnvelopeMetadata,
  resolveBackupEncryptionConfig,
} from "./backup-encryption.mjs";

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const equal = key.indexOf("=");
    if (equal >= 0) {
      args.set(key.slice(0, equal), key.slice(equal + 1));
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, next);
    index += 1;
  }
  return args;
}

function assertCount(payload, key) {
  if (!payload.counts || !Number.isInteger(payload.counts[key])) {
    throw new Error(`${key} のcountsが不正です`);
  }
  if (!Array.isArray(payload[key]) || payload[key].length !== payload.counts[key]) {
    throw new Error(`${key} の件数がcountsと一致しません`);
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("復旧対象payloadがオブジェクトではありません");
  }
  if (![2, 3, 4].includes(payload.schemaVersion)) {
    throw new Error("復旧対象payloadのschemaVersion=2、3、4を確認できません");
  }
  for (const key of [
    "businessDays",
    "reservations",
    "privateBlockAuditLogs",
    "reservationStatusAuditLogs",
    "reservationEmailOutbox",
    "reservationLineLinkTokens",
    "notificationEvents",
  ]) {
    assertCount(payload, key);
  }
  if (payload.schemaVersion >= 3) {
    for (const key of ["businessDayAuditLogs", "reservationCorrectionAuditLogs"]) {
      assertCount(payload, key);
    }
  }
  if (payload.schemaVersion >= 4) {
    for (const key of ["reservationManagementTokens", "reservationIdempotencyRecords"]) {
      assertCount(payload, key);
    }
  }
  return {
    schemaVersion: payload.schemaVersion,
    exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : null,
    date: typeof payload.date === "string" ? payload.date : null,
    counts: payload.counts ?? null,
  };
}

function normalizePayloadShape(payload) {
  // Daily files store the single business-day row as `businessDay`; manual
  // range exports store `businessDays`. Normalize both formats for one drill.
  if (
    !Array.isArray(payload?.businessDays) &&
    Object.prototype.hasOwnProperty.call(payload ?? {}, "businessDay")
  ) {
    return {
      ...payload,
      businessDays: payload.businessDay ? [payload.businessDay] : [],
    };
  }
  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const prohibited of ["apply", "restore", "database-url", "direct-url", "target-db"]) {
    if (args.has(prohibited)) throw new Error(`--${prohibited} は復旧ドリルでは使用できません。DB書き戻しはこのスクリプトの対象外です`);
  }
  const file = args.get("file");
  if (!file) {
    throw new Error("使い方: npm run backup:restore-drill -- --file=backups/reservation-daily-backups/days/2026-08-03.json.enc");
  }
  const filePath = path.resolve(process.cwd(), file);
  if (!filePath.endsWith(".enc")) throw new Error("復旧ドリルは暗号化済み .enc ファイルだけを検証します");
  const serialized = await fs.readFile(filePath, "utf8");
  const config = await resolveBackupEncryptionConfig({
    readFromStdin: args.get("encryption-key-stdin") === "true",
  });
  const envelope = getBackupEnvelopeMetadata(serialized);
  const payload = normalizePayloadShape(decryptBackupPayload(serialized, config));
  const summary = validatePayload(payload);

  console.info(
    JSON.stringify(
      {
        ok: true,
        mode: "DRY_RUN_RESTORE_VALIDATION",
        databaseWrite: "NOT_SUPPORTED",
        file: filePath,
        encryptedFileSha256: createHash("sha256").update(serialized).digest("hex"),
        encryption: envelope,
        payload: summary,
        action: "DBへの書き戻しは実行していません",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`[backup:restore-drill] 失敗: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
