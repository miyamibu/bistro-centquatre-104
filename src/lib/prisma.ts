import { getCloudflareContext } from "@opennextjs/cloudflare/cloudflare-context";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

type HyperdriveBinding = {
  connectionString: string;
};

declare global {
  interface CloudflareEnv {
    HYPERDRIVE?: HyperdriveBinding;
  }

  var __BISTRO_HYPERDRIVE_CONNECTION_STRING__: string | undefined;
}

type GlobalPrismaState = {
  prisma: PrismaClient | undefined;
  prismaResolvedDatabaseUrl: string | null | undefined;
};

const globalForPrisma = globalThis as unknown as GlobalPrismaState;
const cloudflarePrismaClients = new WeakMap<object, PrismaClient>();

const isCloudflareWorkerRuntime = process.env.CLOUDFLARE_WORKER_RUNTIME === "true";

function resolvePrismaDatabaseUrl() {
  const isTestRuntime = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

  if (isTestRuntime && testDatabaseUrl) {
    return testDatabaseUrl;
  }

  return process.env.DATABASE_URL?.trim() || null;
}

const resolvedDatabaseUrl = resolvePrismaDatabaseUrl();
function createPrismaClient(hyperdriveConnectionString?: string) {
  const log = process.env.NODE_ENV === "development" ? ["query", "error", "warn"] as const : ["error"] as const;

  if (isCloudflareWorkerRuntime) {
    if (!hyperdriveConnectionString) {
      throw new Error("HYPERDRIVE binding is required before Prisma can be used in Cloudflare Workers");
    }

    return new PrismaClient({
      adapter: new PrismaPg({ connectionString: hyperdriveConnectionString }),
      log: [...log],
    });
  }

  if (!resolvedDatabaseUrl) {
    throw new Error("DATABASE_URL is required before Prisma can be used");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: resolvedDatabaseUrl }),
    log: [...log],
  });
}

let runtimePrisma = globalForPrisma.prismaResolvedDatabaseUrl === resolvedDatabaseUrl
  ? globalForPrisma.prisma
  : undefined;

function getPrismaClient() {
  if (isCloudflareWorkerRuntime) {
    const { env, ctx } = getCloudflareContext();
    let requestPrisma = cloudflarePrismaClients.get(ctx);
    if (!requestPrisma) {
      requestPrisma = createPrismaClient(env.HYPERDRIVE?.connectionString);
      cloudflarePrismaClients.set(ctx, requestPrisma);
    }
    return requestPrisma;
  }

  runtimePrisma ??= createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = runtimePrisma;
    globalForPrisma.prismaResolvedDatabaseUrl = resolvedDatabaseUrl;
  }
  return runtimePrisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
