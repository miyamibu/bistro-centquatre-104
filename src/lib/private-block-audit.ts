import { randomUUID } from "crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ReservationServicePeriodKey } from "@/lib/reservation-config";

type AuditClient = PrismaClient | Prisma.TransactionClient;

export type PrivateBlockAuditResult = "CREATED" | "NO_OP" | "RELEASED";
export type PrivateBlockAuditSource = "PUBLIC_FORM" | "ADMIN_USER";

export async function createPrivateBlockAuditLog(
  client: AuditClient,
  input: {
    reservationId?: string | null;
    date: string;
    servicePeriod: ReservationServicePeriodKey;
    result: PrivateBlockAuditResult;
    source: PrivateBlockAuditSource;
    actorName?: string | null;
    actorUserId?: string | null;
    actorEmail?: string | null;
    actorRole?: string | null;
    operatorLabel?: string | null;
    requestId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    note?: string | null;
  }
) {
  await client.$executeRaw(
    Prisma.sql`
      INSERT INTO "PrivateBlockAuditLog" (
        "id",
        "reservationId",
        "date",
        "servicePeriod",
        "result",
        "source",
        "actorName",
        "actorUserId",
        "actorEmail",
        "actorRole",
        "operatorLabel",
        "requestId",
        "ipAddress",
        "userAgent",
        "note"
      )
      VALUES (
        ${randomUUID()},
        ${input.reservationId ?? null},
        ${input.date},
        CAST(${input.servicePeriod} AS "ServicePeriod"),
        CAST(${input.result} AS "PrivateBlockAuditResult"),
        CAST(${input.source} AS "PrivateBlockAuditSource"),
        ${input.actorName ?? null},
        ${input.actorUserId ?? null},
        ${input.actorEmail ?? null},
        ${input.actorRole ?? null},
        ${input.operatorLabel ?? null},
        ${input.requestId},
        ${input.ipAddress ?? null},
        ${input.userAgent ?? null},
        ${input.note ?? null}
      )
    `
  );
}
