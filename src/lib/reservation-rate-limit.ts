import { randomUUID } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ReservationServicePeriodKey } from "@/lib/reservation-config";
import { hashText } from "@/lib/request-meta";

const IP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const IP_RATE_LIMIT_MAX = 40;
const PRIVATE_BLOCK_SLOT_WINDOW_MS = 10 * 60 * 1000;
const PRIVATE_BLOCK_SLOT_MAX = 5;

type RateLimitScope = "IP" | "PRIVATE_BLOCK_SLOT";

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
    scope: RateLimitScope;
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

export async function enforceReservationWriteRateLimit(
  prisma: PrismaClient,
  input: {
    ipHash: string;
    privateBlockSlot?: {
      date: string;
      servicePeriod: ReservationServicePeriodKey;
    };
    now?: Date;
  }
) {
  const now = input.now ?? new Date();

  await prisma.$transaction(async (tx) => {
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
      `${input.privateBlockSlot.date}:${input.privateBlockSlot.servicePeriod}`
    );
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
  });
}
