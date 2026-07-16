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
  lineLinkedAt?: Date | null;
  lineLinkSource?: string | null;
  linePushStatus?: string | null;
  linePushCheckedAt?: Date | null;
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
    /(serviceperiod|reservationtype|privateblockauditlog|reservationratelimitevent|lineuserid|linereminder|linelinkedat|linelinksource|linepushstatus|linepushcheckedat|reservationlinelinktoken|notificationevent|linefriend|linecustomerlink)/i.test(
      message
    );
  const hasMissingHint = /(does not exist|not found|unknown|invalid|missing|undefined column)/i.test(
    message
  );

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021" || error.code === "P2022" || error.code === "P2010") {
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
    const schemaRows = await client.$queryRaw<
      Array<{
        reservationTableReady: boolean;
        privateBlockAuditLogReady: boolean;
        reservationRateLimitEventReady: boolean;
        reservationLineColumnsReady: boolean;
        reservationLineLinkTokenReady: boolean;
        notificationEventReady: boolean;
        lineFriendReady: boolean;
        lineCustomerLinkReady: boolean;
        reservationStatusAuditLogReady: boolean;
      }>>(
      Prisma.sql`
      SELECT
        to_regclass('"Reservation"') IS NOT NULL AS "reservationTableReady",
        to_regclass('"PrivateBlockAuditLog"') IS NOT NULL AS "privateBlockAuditLogReady",
        to_regclass('"ReservationRateLimitEvent"') IS NOT NULL AS "reservationRateLimitEventReady",
        (
          SELECT COUNT(*) = 8
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'Reservation'
            AND column_name IN (
              'lineUserId', 'lineReminderSentAt', 'lineReminderStatus',
              'lineReminderError', 'lineLinkedAt', 'lineLinkSource',
              'linePushStatus', 'linePushCheckedAt'
            )
        ) AS "reservationLineColumnsReady",
        to_regclass('"ReservationLineLinkToken"') IS NOT NULL AS "reservationLineLinkTokenReady",
        to_regclass('"NotificationEvent"') IS NOT NULL AS "notificationEventReady",
        to_regclass('"LineFriend"') IS NOT NULL AS "lineFriendReady",
        to_regclass('"LineCustomerLink"') IS NOT NULL AS "lineCustomerLinkReady",
        to_regclass('"ReservationStatusAuditLog"') IS NOT NULL AS "reservationStatusAuditLogReady"
      `
    );
    const schema = schemaRows[0];

    if (!schema || Object.values(schema).some((ready) => !ready)) {
      throw new ReservationSchemaNotReadyError();
    }
  } catch (error) {
    if (error instanceof ReservationSchemaNotReadyError) {
      throw error;
    }

    throwIfReservationSchemaNotReady(error);
    throw error;
  }
}

/**
 * Check that the LINE link tables introduced in migration
 * 20260529150000_line_link_and_notification_ledger exist.
 * Call this from routes that depend on those tables so that
 * a missing migration produces a safe 503 rather than a raw Prisma error.
 */
export async function ensureLineLinkSchemaReady(client: ReservationClient): Promise<void> {
  try {
    await client.$queryRaw`SELECT "id" FROM "ReservationLineLinkToken" LIMIT 0`;
    await client.$queryRaw`SELECT "id" FROM "NotificationEvent" LIMIT 0`;
    await client.$queryRaw`SELECT "lineUserId" FROM "LineFriend" LIMIT 0`;
    await client.$queryRaw`SELECT "id" FROM "LineCustomerLink" LIMIT 0`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isMissing =
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2021" || error.code === "P2022")) ||
      /(does not exist|not found|unknown|invalid|missing)/i.test(message);
    if (isMissing) {
      throw new ReservationSchemaNotReadyError(
        "LINE link tables not found — apply migration 20260529150000_line_link_and_notification_ledger first."
      );
    }
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
