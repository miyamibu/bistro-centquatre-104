#!/usr/bin/env node

import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const outputDir = path.resolve(process.argv[2] || "backups/database-safety-dumps");
const connectionString = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
const encryptionKey = process.env.DB_DUMP_ENCRYPTION_KEY?.trim();
const postgresImage = process.env.DB_DUMP_POSTGRES_IMAGE?.trim() || "postgres:17";

if (!connectionString) throw new Error("DIRECT_URL_OR_DATABASE_URL_MISSING");
if (!encryptionKey || encryptionKey.length < 32) throw new Error("DB_DUMP_ENCRYPTION_KEY_MISSING");

const databaseUrl = new URL(connectionString);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const finalPath = path.join(outputDir, `production-pre-migration-${timestamp}.dump.enc`);
const partialPath = `${finalPath}.partial`;
const manifestPath = `${finalPath}.json`;
const postgresEnv = {
  PATH: process.env.PATH,
  DOCKER_CONFIG: process.env.DOCKER_CONFIG,
  PGHOST: databaseUrl.hostname,
  PGPORT: databaseUrl.port || "5432",
  PGDATABASE: databaseUrl.pathname.replace(/^\//, ""),
  PGUSER: decodeURIComponent(databaseUrl.username),
  PGPASSWORD: decodeURIComponent(databaseUrl.password),
  PGSSLMODE: databaseUrl.searchParams.get("sslmode") || "require",
};
const encryptionEnv = {
  PATH: process.env.PATH,
  DB_DUMP_ENCRYPTION_KEY: encryptionKey,
};

function spawnPostgresTool(tool, args, options = {}) {
  const envNames = options.withConnection
    ? ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE"]
    : [];
  return spawn(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      ...envNames.flatMap((name) => ["--env", name]),
      postgresImage,
      tool,
      ...args,
    ],
    {
      env: options.withConnection ? postgresEnv : { PATH: process.env.PATH, DOCKER_CONFIG: process.env.DOCKER_CONFIG },
      stdio: options.stdio,
    },
  );
}

function collectText(stream, maxBytes = 256 * 1024) {
  let value = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    if (value.length < maxBytes) value += chunk.slice(0, maxBytes - value.length);
  });
  return () => value;
}

function waitFor(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function readSourceCounts() {
  const query = `select json_build_object(
    'Reservation', (select count(*) from public."Reservation"),
    'BusinessDay', (select count(*) from public."BusinessDay"),
    'ReservationEmailOutbox', (select count(*) from public."ReservationEmailOutbox"),
    'ReservationStatusAuditLog', (select count(*) from public."ReservationStatusAuditLog"),
    'ReservationCorrectionAuditLog', (select count(*) from public."ReservationCorrectionAuditLog"),
    'orders', (select count(*) from public.orders),
    'order_actions', (select count(*) from public.order_actions),
    'order_history', (select count(*) from public.order_history),
    'order_notification_outbox', (select count(*) from public.order_notification_outbox),
    'api_idempotency', (select count(*) from public.api_idempotency)
  )`;
  const child = spawnPostgresTool("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", query], {
    withConnection: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const readOutput = collectText(child.stdout, 64 * 1024);
  const readError = collectText(child.stderr, 8 * 1024);
  const result = await waitFor(child);
  if (result.code !== 0) {
    throw new Error(`DB_DUMP_SOURCE_COUNT_FAILED ${result.code ?? result.signal} ${readError()}`);
  }
  return JSON.parse(readOutput().trim());
}

async function verifyEncryptedDump(filePath) {
  const decrypt = spawn(
    "openssl",
    ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-pass", "env:DB_DUMP_ENCRYPTION_KEY", "-in", filePath],
    { env: encryptionEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  const restore = spawnPostgresTool("pg_restore", ["--list"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  decrypt.stdout.pipe(restore.stdin);
  const readList = collectText(restore.stdout);
  const readDecryptError = collectText(decrypt.stderr, 8 * 1024);
  const readRestoreError = collectText(restore.stderr, 8 * 1024);
  const [decryptResult, restoreResult] = await Promise.all([waitFor(decrypt), waitFor(restore)]);
  if (decryptResult.code !== 0 || restoreResult.code !== 0) {
    throw new Error(
      `DB_DUMP_VERIFY_FAILED decrypt=${decryptResult.code ?? decryptResult.signal} restore=${restoreResult.code ?? restoreResult.signal} ${readDecryptError()} ${readRestoreError()}`,
    );
  }
  const list = readList();
  if (!list.includes("TABLE public Reservation") || !list.includes("TABLE public orders")) {
    throw new Error("DB_DUMP_VERIFY_REQUIRED_TABLES_MISSING");
  }
  return list.split("\n").filter((line) => line && !line.startsWith(";")).length;
}

await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
await fs.chmod(outputDir, 0o700);

try {
  const dump = spawnPostgresTool(
    "pg_dump",
    ["--format=custom", "--compress=9", "--no-owner", "--no-privileges", "--schema=public"],
    { withConnection: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const encrypt = spawn(
    "openssl",
    ["enc", "-aes-256-cbc", "-salt", "-pbkdf2", "-iter", "200000", "-pass", "env:DB_DUMP_ENCRYPTION_KEY", "-out", partialPath],
    { env: encryptionEnv, stdio: ["pipe", "ignore", "pipe"] },
  );
  dump.stdout.pipe(encrypt.stdin);
  const readDumpError = collectText(dump.stderr, 8 * 1024);
  const readEncryptError = collectText(encrypt.stderr, 8 * 1024);
  const [dumpResult, encryptResult] = await Promise.all([waitFor(dump), waitFor(encrypt)]);
  if (dumpResult.code !== 0 || encryptResult.code !== 0) {
    throw new Error(
      `DB_DUMP_FAILED dump=${dumpResult.code ?? dumpResult.signal} encrypt=${encryptResult.code ?? encryptResult.signal} ${readDumpError()} ${readEncryptError()}`,
    );
  }

  await fs.chmod(partialPath, 0o600);
  await fs.rename(partialPath, finalPath);
  const encrypted = await fs.readFile(finalPath);
  const sourceCounts = await readSourceCounts();
  const hmacKey = createHash("sha256")
    .update("bistro-db-dump-hmac-v1\0")
    .update(encryptionKey)
    .digest();
  const objectCount = await verifyEncryptedDump(finalPath);
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    purpose: "PRODUCTION_PRE_MIGRATION_SAFETY_DUMP",
    format: "postgresql-custom+openssl-aes-256-cbc-pbkdf2+hmac-sha256",
    postgresImage,
    pbkdf2Iterations: 200000,
    encryptedFile: finalPath,
    encryptedBytes: encrypted.byteLength,
    encryptedSha256: createHash("sha256").update(encrypted).digest("hex"),
    encryptedHmacSha256: createHmac("sha256", hmacKey).update(encrypted).digest("hex"),
    restoreListVerified: true,
    objectCount,
    sourceCounts,
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(manifestPath, 0o600);
  console.info(JSON.stringify({
    status: "PASS",
    encryptedFile: finalPath,
    manifestFile: manifestPath,
    encryptedBytes: manifest.encryptedBytes,
    encryptedSha256: manifest.encryptedSha256,
    restoreListVerified: true,
    objectCount,
  }));
} catch (error) {
  await fs.rm(partialPath, { force: true }).catch(() => undefined);
  throw error;
}
