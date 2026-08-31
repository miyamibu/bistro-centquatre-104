import { PrismaClient } from "@prisma/client";

export type DestructiveTestDbAccess = {
  enabled: boolean;
  reason: string;
};

function parseDatabaseUrl(databaseUrl: string) {
  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
}

function isSafeLocalTestDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) return false;

  const parsed = parseDatabaseUrl(databaseUrl.trim());
  if (!parsed) return false;

  const dbName = parsed.pathname.replace(/^\//, "");
  const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const isTestDatabase = dbName === "test" || dbName.endsWith("_test");
  const isPostgres = parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";

  return isPostgres && isLocalHost && isTestDatabase;
}

export function getDestructiveTestDbAccess(): DestructiveTestDbAccess {
  if (process.env.NODE_ENV === "production") {
    return {
      enabled: false,
      reason: "NODE_ENV=production では破壊的DBテストを実行できません",
    };
  }

  const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testDatabaseUrl) {
    if (process.env.DATABASE_URL?.trim()) {
      return {
        enabled: false,
        reason:
          "TEST_DATABASE_URL が未設定です。DATABASE_URL のみで破壊的DBテストは実行しません",
      };
    }

    return {
      enabled: false,
      reason: "TEST_DATABASE_URL が未設定です",
    };
  }

  if (!isSafeLocalTestDatabaseUrl(testDatabaseUrl)) {
    return {
      enabled: false,
      reason: "TEST_DATABASE_URL は localhost/127.0.0.1 の *_test DB を指定してください",
    };
  }

  if (process.env.ALLOW_DESTRUCTIVE_TEST_DB !== "1") {
    return {
      enabled: false,
      reason:
        "ALLOW_DESTRUCTIVE_TEST_DB=1 が未設定のため破壊的DB cleanup をブロックしました",
    };
  }

  return {
    enabled: true,
    reason: "ready",
  };
}

export function assertDestructiveCleanupAllowed() {
  const access = getDestructiveTestDbAccess();
  if (!access.enabled) {
    throw new Error(access.reason);
  }
}

export function createTestPrismaClient() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

  if (!testDatabaseUrl || !isSafeLocalTestDatabaseUrl(testDatabaseUrl)) {
    throw new Error("Safe TEST_DATABASE_URL is required for destructive DB tests");
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: testDatabaseUrl,
      },
    },
  });
}
