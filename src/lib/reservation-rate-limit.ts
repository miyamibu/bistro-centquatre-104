import { randomUUID } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ReservationServicePeriodKey } from "@/lib/reservation-config";
import { hashText } from "@/lib/request-meta";

const IP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const IP_RATE_LIMIT_MAX = 40;
const PRIVATE_BLOCK_SLOT_WINDOW_MS = 10 * 60 * 1000;
const PRIVATE_BLOCK_SLOT_MAX = 5;

type RateLimitScope = "IP" | "PRIVATE_BLOCK_SLOT";

type ReservationRateLimitInput = {
  ipHash: string;
  privateBlockSlot?: {
    date: string;
    servicePeriod: ReservationServicePeriodKey;
  };
  now?: Date;
};

class ReservationRateLimitError extends Error {
  readonly code = "RATE_LIMITED";
  readonly status = 429;

  constructor(
    readonly scope: RateLimitScope,
    message = "リクエストが集中しています。時間をおいて再試行してください。"
  ) {
    super(message);
    this.name = "ReservationRateLimitError";
  }
}

export function isReservationRateLimitError(
  error: unknown
): error is ReservationRateLimitError {
  return error instanceof ReservationRateLimitError;
}

async function countRecentEvents(
  tx: Prisma.TransactionClient,
  input: {
    keyHash: string;
    scope: RateLimitScope;
    since: Date;
    date?: string;
    servicePeriod?: ReservationServicePeriodKey;
  }
): Promise<number> {
  if (input.date && input.servicePeriod) {
    const rows = await tx.$queryRaw<Array<{ count: bigint | number | string }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "ReservationRateLimitEvent"
        WHERE "keyHash" = ${input.keyHash}
          AND "scope" = ${input.scope}
          AND "date" = ${input.date}
          AND "servicePeriod" = CAST(${input.servicePeriod} AS "ServicePeriod")
          AND "createdAt" >= ${input.since}
      `
    );
    return Number(rows[0]?.count ?? 0);
  }

  const rows = await tx.$queryRaw<Array<{ count: bigint | number | string }>>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "ReservationRateLimitEvent"
      WHERE "keyHash" = ${input.keyHash}
        AND "scope" = ${input.scope}
        AND "createdAt" >= ${input.since}
    `
  );
  return Number(rows[0]?.count ?? 0);
}

async function appendRateLimitEvent(
  tx: Prisma.TransactionClient,
  input: {
    keyHash: string;
    scope: string;
    date?: string;
    servicePeriod?: ReservationServicePeriodKey;
  }
) {
  const servicePeriodSql = input.servicePeriod
    ? Prisma.sql`CAST(${input.servicePeriod} AS "ServicePeriod")`
    : Prisma.sql`NULL`;

  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO "ReservationRateLimitEvent" (
        "id",
        "keyHash",
        "scope",
        "date",
        "servicePeriod"
      )
      VALUES (
        ${randomUUID()},
        ${input.keyHash},
        ${input.scope},
        ${input.date ?? null},
        ${servicePeriodSql}
      )
    `
  );
}

async function acquireRateLimitAdvisoryLock(
  tx: Prisma.TransactionClient,
  scope: string,
  keyHash: string
) {
  await tx.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    `reservation-rate-limit:${scope}:${keyHash}`
  );
}

export async function enforceScopedRateLimit(
  prisma: PrismaClient,
  input: {
    keyHash: string;
    scope: string;
    windowMs: number;
    limit: number;
    now?: Date;
  }
): Promise<boolean> {
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - input.windowMs);

  return prisma.$transaction(async (tx) => {
    await acquireRateLimitAdvisoryLock(tx, input.scope, input.keyHash);
    const rows = await tx.$queryRaw<Array<{ count: bigint | number | string }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "ReservationRateLimitEvent"
        WHERE "keyHash" = ${input.keyHash}
          AND "scope" = ${input.scope}
          AND "createdAt" >= ${since}
      `
    );
    if (Number(rows[0]?.count ?? 0) >= input.limit) return false;

    await appendRateLimitEvent(tx, { keyHash: input.keyHash, scope: input.scope });
    return true;
  });
}

export async function enforceReservationWriteRateLimitInTransaction(
  tx: Prisma.TransactionClient,
  input: ReservationRateLimitInput
) {
  const now = input.now ?? new Date();

  await acquireRateLimitAdvisoryLock(tx, "IP", input.ipHash);
  const ipSince = new Date(now.getTime() - IP_RATE_LIMIT_WINDOW_MS);
  const ipCount = await countRecentEvents(tx, {
    keyHash: input.ipHash,
    scope: "IP",
    since: ipSince,
  });

  if (ipCount >= IP_RATE_LIMIT_MAX) {
    throw new ReservationRateLimitError("IP");
  }

  await appendRateLimitEvent(tx, {
    keyHash: input.ipHash,
    scope: "IP",
  });

  if (!input.privateBlockSlot) {
    return;
  }

  const privateBlockKeyHash = hashText(
    `${input.privateBlockSlot.date}:${input.privateBlockSlot.servicePeriod}`,
    "private-block-slot"
  );
  await acquireRateLimitAdvisoryLock(tx, "PRIVATE_BLOCK_SLOT", privateBlockKeyHash);
  const privateBlockSince = new Date(now.getTime() - PRIVATE_BLOCK_SLOT_WINDOW_MS);
  const privateBlockCount = await countRecentEvents(tx, {
    keyHash: privateBlockKeyHash,
    scope: "PRIVATE_BLOCK_SLOT",
    date: input.privateBlockSlot.date,
    servicePeriod: input.privateBlockSlot.servicePeriod,
    since: privateBlockSince,
  });

  if (privateBlockCount >= PRIVATE_BLOCK_SLOT_MAX) {
    throw new ReservationRateLimitError("PRIVATE_BLOCK_SLOT");
  }

  await appendRateLimitEvent(tx, {
    keyHash: privateBlockKeyHash,
    scope: "PRIVATE_BLOCK_SLOT",
    date: input.privateBlockSlot.date,
    servicePeriod: input.privateBlockSlot.servicePeriod,
  });
}

export async function enforceReservationWriteRateLimit(
  prisma: PrismaClient,
  input: ReservationRateLimitInput
) {
  await prisma.$transaction((tx) => enforceReservationWriteRateLimitInTransaction(tx, input));
}
