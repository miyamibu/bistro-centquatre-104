import {
  Prisma,
  ReservationStatus,
  ReservationType,
  type PrismaClient,
  type SeatType,
} from "@prisma/client";
import type { ReservationServicePeriodKey } from "@/lib/reservation-config";

type ReservationClient = PrismaClient | Prisma.TransactionClient;
const RESERVATION_SCHEMA_READY_CACHE_TTL_MS = 5 * 60 * 1000;
let reservationSchemaReadyCheckedAt = 0;
let reservationSchemaReadyCheckPromise: Promise<void> | null = null;

type ReservationCreateCompatInput = {
  date: string;
  servicePeriod: ReservationServicePeriodKey;
  reservationType: ReservationType;
  seatType: SeatType;
  partySize: number;
  arrivalTime: string | null;
  name: string;
  phone: string;
  note: string | null;
  status: ReservationStatus;
  lineUserId: string | null;
};

export const RESERVATION_SCHEMA_NOT_READY_CODE = "RESERVATION_SCHEMA_NOT_READY";
export const RESERVATION_SCHEMA_NOT_READY_MESSAGE =
  "予約機能のデータベース移行が未完了です。migration 適用後に再試行してください。";

export class ReservationSchemaNotReadyError extends Error {
  readonly code = RESERVATION_SCHEMA_NOT_READY_CODE;

  constructor(message: string = RESERVATION_SCHEMA_NOT_READY_MESSAGE) {
    super(message);
    this.name = "ReservationSchemaNotReadyError";
  }
}

function isMissingReservationInfrastructureError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const hasReservationSchemaHint =
    /(serviceperiod|reservationtype|privateblockauditlog|reservationratelimitevent)/i.test(
      message
    );
  const hasMissingHint = /(does not exist|not found|unknown|invalid|missing|undefined column)/i.test(
    message
  );

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021" || error.code === "P2022") {
      return true;
    }

    return hasReservationSchemaHint && hasMissingHint;
  }

  return hasReservationSchemaHint && hasMissingHint;
}

function throwIfReservationSchemaNotReady(error: unknown): void {
  if (isMissingReservationInfrastructureError(error)) {
    throw new ReservationSchemaNotReadyError();
  }
}

export function isReservationSchemaNotReadyError(
  error: unknown
): error is ReservationSchemaNotReadyError {
  return error instanceof ReservationSchemaNotReadyError;
}

async function runReservationSchemaReadyCheck(client: ReservationClient) {
  try {
    await client.$queryRaw`
      SELECT
        "servicePeriod",
        "reservationType"
      FROM "Reservation"
      LIMIT 0
    `;
    await client.$queryRaw`
      SELECT
        "id"
      FROM "PrivateBlockAuditLog"
      LIMIT 0
    `;
    await client.$queryRaw`
      SELECT
        "id"
      FROM "ReservationRateLimitEvent"
      LIMIT 0
    `;
  } catch (error) {
    throwIfReservationSchemaNotReady(error);
    throw error;
  }
}

export async function ensureReservationSchemaReady(client: ReservationClient) {
  if (Date.now() - reservationSchemaReadyCheckedAt < RESERVATION_SCHEMA_READY_CACHE_TTL_MS) {
    return;
  }

  if (!reservationSchemaReadyCheckPromise) {
    reservationSchemaReadyCheckPromise = (async () => {
      try {
        await runReservationSchemaReadyCheck(client);
        reservationSchemaReadyCheckedAt = Date.now();
      } finally {
        reservationSchemaReadyCheckPromise = null;
      }
    })();
  }

  await reservationSchemaReadyCheckPromise;
}

export async function findReservationsCompat(
  client: ReservationClient,
  args: Prisma.ReservationFindManyArgs
) {
  try {
    return await client.reservation.findMany(args);
  } catch (error) {
    throwIfReservationSchemaNotReady(error);
    throw error;
  }
}

export async function findReservationByIdCompat(client: ReservationClient, id: string) {
  try {
    return await client.reservation.findUnique({ where: { id } });
  } catch (error) {
    throwIfReservationSchemaNotReady(error);
    throw error;
  }
}

export async function createReservationCompat(
  client: ReservationClient,
  data: ReservationCreateCompatInput
) {
  try {
    return await client.reservation.create({ data });
  } catch (error) {
    throwIfReservationSchemaNotReady(error);
    throw error;
  }
}

export async function updateReservationStatusCompat(
  client: ReservationClient,
  id: string,
  status: ReservationStatus
) {
  try {
    return await client.reservation.update({
      where: { id },
      data: { status },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return null;
    }

    throwIfReservationSchemaNotReady(error);
    throw error;
  }
}
