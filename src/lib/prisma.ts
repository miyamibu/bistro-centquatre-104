import { PrismaClient } from "@prisma/client";

type GlobalPrismaState = {
  prisma: PrismaClient | undefined;
  prismaResolvedDatabaseUrl: string | null | undefined;
};

const globalForPrisma = globalThis as unknown as GlobalPrismaState;

function resolvePrismaDatabaseUrl() {
  const isTestRuntime = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

  if (isTestRuntime && testDatabaseUrl) {
    return testDatabaseUrl;
  }

  return null;
}

const resolvedDatabaseUrl = resolvePrismaDatabaseUrl();
const shouldReuseGlobalPrisma =
  globalForPrisma.prisma &&
  globalForPrisma.prismaResolvedDatabaseUrl === resolvedDatabaseUrl;

export const prisma =
  shouldReuseGlobalPrisma && globalForPrisma.prisma
    ? globalForPrisma.prisma
    : new PrismaClient({
        ...(resolvedDatabaseUrl
          ? {
              datasources: {
                db: {
                  url: resolvedDatabaseUrl,
                },
              },
            }
          : {}),
        log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
      });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaResolvedDatabaseUrl = resolvedDatabaseUrl;
}
