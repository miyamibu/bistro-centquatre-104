import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

export const RESERVATION_IDEMPOTENCY_KEY_MAX_LENGTH = 255;

type ReservationIdempotencyClient = PrismaClient | Prisma.TransactionClient;

export type ReservationIdempotencyRecord = {
  id: string;
  idempotencyKey: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: Prisma.JsonValue | null;
  reservationId: string | null;
  tokenKeyId: string | null;
};

export class ReservationIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  readonly status = 409;

  constructor() {
    super("同じキーで別の内容は送信できません");
    this.name = "ReservationIdempotencyConflictError";
  }
}

export class ReservationIdempotencyInProgressError extends Error {
  readonly code = "IDEMPOTENCY_IN_PROGRESS";
  readonly status = 409;

  constructor() {
    super("同じキーの処理が進行中です。時間をおいて再試行してください");
    this.name = "ReservationIdempotencyInProgressError";
  }
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(String(value));
}

export function buildReservationRequestHash(body: unknown) {
  return createHash("sha256").update(stableSerialize(body)).digest("hex");
}

export function isValidReservationIdempotencyKey(value: string) {
  return value.length > 0 && value.length <= RESERVATION_IDEMPOTENCY_KEY_MAX_LENGTH;
}

const reservationIdempotencySelect = {
  id: true,
  idempotencyKey: true,
  requestHash: true,
  responseStatus: true,
  responseBody: true,
  reservationId: true,
  tokenKeyId: true,
} as const;

export async function findReservationIdempotency(
  client: ReservationIdempotencyClient,
  idempotencyKey: string
): Promise<ReservationIdempotencyRecord | null> {
  return client.reservationIdempotency.findUnique({
    where: { idempotencyKey },
    select: reservationIdempotencySelect,
  });
}

export async function claimReservationIdempotency(
  tx: Prisma.TransactionClient,
  input: { idempotencyKey: string; requestHash: string }
) {
  const now = new Date();
  const inserted = await tx.reservationIdempotency.createMany({
    data: [
      {
        id: randomUUID(),
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        createdAt: now,
        updatedAt: now,
      },
    ],
    skipDuplicates: true,
  });
  const record = await findReservationIdempotency(tx, input.idempotencyKey);

  if (!record) {
    throw new Error("RESERVATION_IDEMPOTENCY_RECORD_NOT_FOUND");
  }

  if (record.requestHash !== input.requestHash) {
    throw new ReservationIdempotencyConflictError();
  }

  if (inserted.count === 0) {
    if (record.responseStatus !== null && record.responseBody !== null) {
      return {
        kind: "replay" as const,
        responseStatus: record.responseStatus,
        responseBody: record.responseBody,
        reservationId: record.reservationId,
      };
    }

    throw new ReservationIdempotencyInProgressError();
  }

  return { kind: "claimed" as const, id: record.id };
}

export async function finalizeReservationIdempotency(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    responseStatus: number;
    responseBody: Prisma.InputJsonValue;
    reservationId: string;
    tokenKeyId: string;
  }
) {
  await tx.reservationIdempotency.update({
    where: { id: input.id },
    data: {
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      reservationId: input.reservationId,
      tokenKeyId: input.tokenKeyId,
    },
  });
}
