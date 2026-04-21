import { PrismaClient } from "@prisma/client";

export function summarizeDatabaseUrl(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(unparseable database url)";
  }
}

export function isSafeTestDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) return false;

  try {
    const parsed = new URL(databaseUrl);
    const databaseName = parsed.pathname.replace(/^\//, "");
    const isLocalHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const isTestDatabase = /(^test$|_test$|test$)/i.test(databaseName);
    return isLocalHost && isTestDatabase;
  } catch {
    return false;
  }
}

export const safeTestDatabaseUrl = isSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL)
  ? process.env.TEST_DATABASE_URL!.trim()
  : null;

export function createTestPrismaClient() {
  if (!safeTestDatabaseUrl) {
    throw new Error(
      "Safe TEST_DATABASE_URL is required for destructive DB tests. Use a local *_test database."
    );
  }

  return new PrismaClient({
    datasources: {
      db: {
        url: safeTestDatabaseUrl,
      },
    },
  });
}
