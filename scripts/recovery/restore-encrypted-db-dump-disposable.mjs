#!/usr/bin/env node

import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function readArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const encryptedPath = path.resolve(readArg("file") ?? "");
if (!encryptedPath.endsWith(".dump.enc")) {
  throw new Error("--file must identify a .dump.enc artifact created by the database safety dump script.");
}
const manifestPath = path.resolve(readArg("manifest") || `${encryptedPath}.json`);
const encryptionKey = process.env.DB_DUMP_ENCRYPTION_KEY?.trim();
if (!encryptionKey || encryptionKey.length < 32) throw new Error("DB_DUMP_ENCRYPTION_KEY_MISSING");

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const encrypted = await fs.readFile(encryptedPath);
const encryptedSha256 = createHash("sha256").update(encrypted).digest("hex");
if (encryptedSha256 !== manifest.encryptedSha256) throw new Error("ENCRYPTED_DUMP_SHA256_MISMATCH");
if (!manifest.encryptedHmacSha256) throw new Error("AUTHENTICATED_DUMP_MANIFEST_REQUIRED");
if (manifest.encryptedHmacSha256) {
  const hmacKey = createHash("sha256")
    .update("bistro-db-dump-hmac-v1\0")
    .update(encryptionKey)
    .digest();
  const hmac = createHmac("sha256", hmacKey).update(encrypted).digest("hex");
  if (hmac !== manifest.encryptedHmacSha256) throw new Error("ENCRYPTED_DUMP_HMAC_MISMATCH");
}

const image = manifest.postgresImage || "postgres:17";
if (!/^postgres:17(?:[.-][A-Za-z0-9.-]+)?$/.test(image)) throw new Error("POSTGRES_17_IMAGE_REQUIRED");
const suffix = randomBytes(6).toString("hex");
const container = `bistro-restore-${suffix}`;
const database = `bistro_restore_${suffix}`;
const password = randomBytes(32).toString("base64url");
const dockerEnv = {
  PATH: process.env.PATH,
  DOCKER_CONFIG: process.env.DOCKER_CONFIG,
  POSTGRES_PASSWORD: password,
  POSTGRES_DB: database,
};
const decryptEnv = { PATH: process.env.PATH, DB_DUMP_ENCRYPTION_KEY: encryptionKey };

function docker(args, options = {}) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    env: options.env ?? dockerEnv,
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function assertSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label}_FAILED ${(result.stderr || result.stdout || "").slice(-4000)}`);
  }
  return result.stdout;
}

function execSql(sql) {
  return assertSuccess(
    docker(["exec", "-i", container, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], {
      input: sql,
    }),
    "DISPOSABLE_SQL",
  );
}

function waitFor(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

let started = false;
try {
  assertSuccess(
    docker([
      "run",
      "--detach",
      "--rm",
      "--name",
      container,
      "--env",
      "POSTGRES_PASSWORD",
      "--env",
      "POSTGRES_DB",
      image,
    ]),
    "DISPOSABLE_POSTGRES_START",
  );
  started = true;

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = docker(["exec", container, "pg_isready", "-U", "postgres", "-d", database]);
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("DISPOSABLE_POSTGRES_NOT_READY");

  execSql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role bistro_app_runtime nologin nosuperuser nobypassrls;
    create role bistro_preview_runtime nologin nosuperuser nobypassrls;
    drop schema public cascade;
    create schema if not exists auth;
    create schema if not exists extensions;
    create schema if not exists private;
    create extension if not exists pgcrypto with schema extensions;
    create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create or replace function private.bump_shared_tag_version() returns trigger language plpgsql as $$
      begin if TG_OP = 'DELETE' then return OLD; else return NEW; end if; end
    $$;
    create or replace function private.require_single_active_shared_tag_owner() returns trigger language plpgsql as $$
      begin if TG_OP = 'DELETE' then return OLD; else return NEW; end if; end
    $$;
    create or replace function private.set_updated_at() returns trigger language plpgsql as $$
      begin if TG_OP = 'DELETE' then return OLD; else return NEW; end if; end
    $$;
  `);

  async function restoreSection(section) {
    const decrypt = spawn(
      "openssl",
      ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-pass", "env:DB_DUMP_ENCRYPTION_KEY", "-in", encryptedPath],
      { env: decryptEnv, stdio: ["ignore", "pipe", "pipe"] },
    );
    const restore = spawn(
      "docker",
      [
        "exec",
        "-i",
        container,
        "pg_restore",
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        `--section=${section}`,
        "-U",
        "postgres",
        "-d",
        database,
      ],
      { env: dockerEnv, stdio: ["pipe", "ignore", "pipe"] },
    );
    decrypt.stdout.pipe(restore.stdin);
    let decryptError = "";
    let restoreError = "";
    decrypt.stderr.on("data", (chunk) => { decryptError += chunk.toString(); });
    restore.stderr.on("data", (chunk) => { restoreError += chunk.toString(); });
    const [decryptResult, restoreResult] = await Promise.all([waitFor(decrypt), waitFor(restore)]);
    if (decryptResult.code !== 0 || restoreResult.code !== 0) {
      throw new Error(
        `DISPOSABLE_RESTORE_${section.toUpperCase()}_FAILED decrypt=${decryptResult.code ?? decryptResult.signal} restore=${restoreResult.code ?? restoreResult.signal} ${decryptError.slice(-2000)} ${restoreError.slice(-4000)}`,
      );
    }
  }

  await restoreSection("pre-data");
  await restoreSection("data");
  execSql(`
    create table if not exists auth.users (id uuid primary key);
    insert into auth.users (id)
    select distinct user_id from public.user_entitlement_grants where user_id is not null
    on conflict (id) do nothing;
  `);
  await restoreSection("post-data");

  const candidateMigrationFiles = [
    "prisma/migrations/20260901140000_reservation_change_notification/migration.sql",
    "supabase/migrations/20260901140000_atomic_nonterminal_order_mutations.sql",
  ];
  const appliedMigrationFiles = [];
  for (const migrationFile of candidateMigrationFiles) {
    const migrationPath = path.resolve(process.cwd(), migrationFile);
    try {
      const sql = await fs.readFile(migrationPath, "utf8");
      execSql(sql);
      appliedMigrationFiles.push(migrationFile);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }

  const countTables = Object.keys(manifest.sourceCounts ?? {});
  if (countTables.length === 0 || countTables.some((table) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(table))) {
    throw new Error("INVALID_SOURCE_COUNT_TABLES");
  }
  const countExpression = countTables
    .map((table) => `'${table}', (select count(*) from public.${/^[a-z_]+$/.test(table) ? table : `"${table}"`})`)
    .join(",");
  const restoredCounts = JSON.parse(
    execSql(`select json_build_object(${countExpression});`).trim().split("\n").at(-1),
  );
  if (JSON.stringify(restoredCounts) !== JSON.stringify(manifest.sourceCounts)) {
    throw new Error("DISPOSABLE_RESTORE_ROW_COUNT_MISMATCH");
  }

  const integrity = JSON.parse(
    execSql(`select json_build_object(
      'unvalidatedConstraints', (select count(*) from pg_constraint where not convalidated),
      'publicTables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
      'publicIndexes', (select count(*) from pg_indexes where schemaname='public'),
      'rlsTables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity)
    );`).trim().split("\n").at(-1),
  );
  if (Number(integrity.unvalidatedConstraints) !== 0) throw new Error("UNVALIDATED_CONSTRAINTS_FOUND");

  console.info(JSON.stringify({
    status: "PASS",
    mode: "DISPOSABLE_POSTGRES_17_RESTORE",
    plaintextDumpAtRest: false,
    encryptedSha256,
    hmacVerified: Boolean(manifest.encryptedHmacSha256),
    sourceCountsMatched: true,
    appliedMigrationFiles,
    restoredCounts,
    integrity,
    disposableContainerRemoved: true,
  }));
} finally {
  if (started) docker(["rm", "--force", container]);
}
