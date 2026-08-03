#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

function isSafeLocalTestDatabaseUrl(value) {
  if (!value) return false;

  try {
    const parsed = new URL(value.trim());
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
    const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const isTestDatabase = databaseName === "test" || databaseName.endsWith("_test");
    const isPostgres = parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";
    return isPostgres && isLocalHost && isTestDatabase;
  } catch {
    return false;
  }
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

if (!testDatabaseUrl) {
  console.warn(
    "[test:db] TEST_DATABASE_URL が未設定のため、破壊的DBテストを実行せずスキップしました"
  );
  process.exit(0);
}

if (!isSafeLocalTestDatabaseUrl(testDatabaseUrl)) {
  console.error(
    "[test:db] TEST_DATABASE_URL は localhost/127.0.0.1 の *_test DB だけを指定してください"
  );
  process.exit(1);
}

if (process.env.ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
  console.warn(
    "[test:db] ALLOW_DESTRUCTIVE_TEST_DB=1 が未設定のため、破壊的DBテストを実行せずスキップしました"
  );
  process.exit(0);
}

const result = spawnSync("npm", ["run", "test:db:runner"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
