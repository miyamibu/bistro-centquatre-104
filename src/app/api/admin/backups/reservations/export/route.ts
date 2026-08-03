import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api-security";
import { dateStringSchema, zodFields } from "@/lib/validation";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getRequestId, logError, logInfo } from "@/lib/logger";
import {
  ensureReservationSchemaReady,
  findReservationsCompat,
  isReservationSchemaNotReadyError,
  RESERVATION_SCHEMA_NOT_READY_CODE,
} from "@/lib/reservation-compat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_EXPORT_RANGE_DAYS = 31;
const BACKUP_SCHEMA_VERSION = 2;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const exportQuerySchema = z
  .object({
    date: dateStringSchema.optional(),
    from: dateStringSchema.optional(),
    to: dateStringSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasDate = Boolean(value.date);
    const hasFrom = Boolean(value.from);
    const hasTo = Boolean(value.to);

    if (hasDate) {
      if (hasFrom || hasTo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["date"],
          message: "`date` 指定時は `from` / `to` を同時指定できません",
        });
      }
      return;
    }

    if (!hasFrom && !hasTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "`date` もしくは `from` / `to` を指定してください",
      });
      return;
    }

    if (hasFrom !== hasTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasFrom ? "to" : "from"],
        message: "`from` と `to` は両方指定してください",
      });
    }
  });

type DateRange = {
  from: string;
  to: string;
  days: number;
};

class DateRangeValidationError extends Error {
  readonly code = "INVALID_DATE_RANGE";

  constructor(message: string) {
    super(message);
    this.name = "DateRangeValidationError";
  }
}

function parseDateStrict(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function safeEqual(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
}

function isAuthorizedBackupExport(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const customHeader = request.headers.get("x-backup-export-secret");

  let presentedToken: string | undefined;
  if (customHeader?.trim()) {
    presentedToken = customHeader.trim();
  } else if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      presentedToken = match[1]?.trim();
    }
  }

  const expectedToken = env.BACKUP_EXPORT_SECRET?.trim();
  if (!presentedToken || !expectedToken) return false;

  return safeEqual(presentedToken, expectedToken);
}

function backupApiError(status: number, payload: Parameters<typeof apiError>[1]) {
  return apiError(status, payload, { headers: NO_STORE_HEADERS });
}

function resolveDateRange(query: z.infer<typeof exportQuerySchema>): DateRange {
  const from = query.date ?? query.from;
  const to = query.date ?? query.to;
  if (!from || !to) {
    throw new DateRangeValidationError("`date` もしくは `from` / `to` を指定してください");
  }

  const parsedFrom = parseDateStrict(from);
  const parsedTo = parseDateStrict(to);
  if (!parsedFrom || !parsedTo) {
    throw new DateRangeValidationError("日付は有効な YYYY-MM-DD を指定してください");
  }

  if (parsedFrom.getTime() > parsedTo.getTime()) {
    throw new DateRangeValidationError("`from` は `to` 以下の日付にしてください");
  }

  const days = Math.floor((parsedTo.getTime() - parsedFrom.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (days > MAX_EXPORT_RANGE_DAYS) {
    throw new DateRangeValidationError(
      `一度に取得できる期間は最大 ${MAX_EXPORT_RANGE_DAYS} 日です`
    );
  }

  return {
    from,
    to,
    days,
  };
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/admin/backups/reservations/export";

  if (!isAuthorizedBackupExport(request)) {
    return backupApiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const parsedQuery = exportQuerySchema.safeParse({
    date: request.nextUrl.searchParams.get("date") ?? undefined,
    from: request.nextUrl.searchParams.get("from") ?? undefined,
    to: request.nextUrl.searchParams.get("to") ?? undefined,
  });

  if (!parsedQuery.success) {
    return backupApiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      fields: zodFields(parsedQuery.error),
      requestId,
    });
  }

  let range: DateRange;
  try {
    range = resolveDateRange(parsedQuery.data);
  } catch (error) {
    if (error instanceof DateRangeValidationError) {
      return backupApiError(400, {
        error: error.message,
        code: error.code,
        requestId,
      });
    }
    throw error;
  }

  try {
    await ensureReservationSchemaReady(prisma);

    const [businessDays, reservations, privateBlockAuditLogs] = await Promise.all([
      prisma.businessDay.findMany({
        where: {
          date: {
            gte: range.from,
            lte: range.to,
          },
        },
        orderBy: [{ date: "asc" }],
      }),
      findReservationsCompat(prisma, {
        where: {
          date: {
            gte: range.from,
            lte: range.to,
          },
        },
        orderBy: [{ date: "asc" }, { servicePeriod: "asc" }, { createdAt: "asc" }],
      }),
      prisma.privateBlockAuditLog.findMany({
        where: {
          date: {
            gte: range.from,
            lte: range.to,
          },
        },
        orderBy: [{ date: "asc" }, { servicePeriod: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    const reservationIds = reservations.map((row) => row.id);
    const relatedRows =
      reservationIds.length === 0
        ? null
        : await Promise.all([
            prisma.reservationStatusAuditLog.findMany({
              where: { reservationId: { in: reservationIds } },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            }),
            prisma.reservationEmailOutbox.findMany({
              where: { reservationId: { in: reservationIds } },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            }),
            prisma.reservationLineLinkToken.findMany({
              where: { reservationId: { in: reservationIds } },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            }),
            prisma.notificationEvent.findMany({
              where: { reservationId: { in: reservationIds } },
              orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            }),
          ]);
    const reservationStatusAuditLogs = relatedRows?.[0] ?? [];
    const reservationEmailOutbox = relatedRows?.[1] ?? [];
    const reservationLineLinkTokens = relatedRows?.[2] ?? [];
    const notificationEvents = relatedRows?.[3] ?? [];

    const payload = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      range,
      counts: {
        businessDays: businessDays.length,
        reservations: reservations.length,
        privateBlockAuditLogs: privateBlockAuditLogs.length,
        reservationStatusAuditLogs: reservationStatusAuditLogs.length,
        reservationEmailOutbox: reservationEmailOutbox.length,
        reservationLineLinkTokens: reservationLineLinkTokens.length,
        notificationEvents: notificationEvents.length,
      },
      businessDays: businessDays.map((row) => ({
        id: row.id,
        date: row.date,
        isClosed: row.isClosed,
        note: row.note,
      })),
      reservations: reservations.map((row) => ({
        id: row.id,
        date: row.date,
        servicePeriod: row.servicePeriod,
        reservationType: row.reservationType,
        seatType: row.seatType,
        partySize: row.partySize,
        arrivalTime: row.arrivalTime,
        name: row.name,
        phone: row.phone,
        customerEmail: row.customerEmail,
        customerEmailVerifiedAt: row.customerEmailVerifiedAt?.toISOString() ?? null,
        contactChannel: row.contactChannel,
        note: row.note,
        status: row.status,
        cancellationPolicyVersion: row.cancellationPolicyVersion,
        cancellationPolicyAcceptedAt: row.cancellationPolicyAcceptedAt?.toISOString() ?? null,
        cancelledAt: row.cancelledAt?.toISOString() ?? null,
        cancelSource: row.cancelSource,
        cancellationReason: row.cancellationReason,
        lineUserId: row.lineUserId,
        lineReminderSentAt: row.lineReminderSentAt?.toISOString() ?? null,
        lineReminderStatus: row.lineReminderStatus,
        lineReminderError: row.lineReminderError,
        lineClaimTokenHash: row.lineClaimTokenHash,
        lineClaimExpiresAt: row.lineClaimExpiresAt?.toISOString() ?? null,
        lineConfirmationSentAt: row.lineConfirmationSentAt?.toISOString() ?? null,
        lineLinkedAt: row.lineLinkedAt?.toISOString() ?? null,
        lineLinkSource: row.lineLinkSource,
        linePushStatus: row.linePushStatus,
        linePushCheckedAt: row.linePushCheckedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      privateBlockAuditLogs: privateBlockAuditLogs.map((row) => ({
        id: row.id,
        reservationId: row.reservationId,
        date: row.date,
        servicePeriod: row.servicePeriod,
        result: row.result,
        source: row.source,
        actorName: row.actorName,
        requestId: row.requestId,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
      reservationStatusAuditLogs: reservationStatusAuditLogs.map((row) => ({
        id: row.id,
        reservationId: row.reservationId,
        actorName: row.actorName,
        requestId: row.requestId,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        previousStatus: row.previousStatus,
        nextStatus: row.nextStatus,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      })),
      reservationEmailOutbox: reservationEmailOutbox.map((row) => ({
        id: row.id,
        reservationId: row.reservationId,
        notificationType: row.notificationType,
        status: row.status,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
        claimedAt: row.claimedAt?.toISOString() ?? null,
        lockedUntil: row.lockedUntil?.toISOString() ?? null,
        // claimToken is a live worker credential and is intentionally excluded.
        sentAt: row.sentAt?.toISOString() ?? null,
        lastError: row.lastError,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      reservationLineLinkTokens: reservationLineLinkTokens.map((row) => ({
        id: row.id,
        reservationId: row.reservationId,
        // Only the one-way hash is recoverable; a reusable raw token is never exported.
        tokenHash: row.tokenHash,
        keyId: row.keyId,
        expiresAt: row.expiresAt.toISOString(),
        usedAt: row.usedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      notificationEvents: notificationEvents.map((row) => ({
        id: row.id,
        reservationId: row.reservationId,
        channel: row.channel,
        type: row.type,
        targetDate: row.targetDate,
        status: row.status,
        retryKey: row.retryKey,
        claimedAt: row.claimedAt?.toISOString() ?? null,
        sentAt: row.sentAt?.toISOString() ?? null,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };

    const checksumSource = JSON.stringify({
      schemaVersion: payload.schemaVersion,
      range: payload.range,
      counts: payload.counts,
      businessDays: payload.businessDays,
      reservations: payload.reservations,
      privateBlockAuditLogs: payload.privateBlockAuditLogs,
      reservationStatusAuditLogs: payload.reservationStatusAuditLogs,
      reservationEmailOutbox: payload.reservationEmailOutbox,
      reservationLineLinkTokens: payload.reservationLineLinkTokens,
      notificationEvents: payload.notificationEvents,
    });

    const checksumSha256 = createHash("sha256").update(checksumSource).digest("hex");

    logInfo("admin.backups.reservations.export.success", {
      requestId,
      route,
      context: {
        from: range.from,
        to: range.to,
        days: range.days,
        reservationCount: payload.counts.reservations,
        businessDayCount: payload.counts.businessDays,
        privateBlockAuditLogCount: payload.counts.privateBlockAuditLogs,
        reservationStatusAuditLogCount: payload.counts.reservationStatusAuditLogs,
        reservationEmailOutboxCount: payload.counts.reservationEmailOutbox,
        reservationLineLinkTokenCount: payload.counts.reservationLineLinkTokens,
        notificationEventCount: payload.counts.notificationEvents,
      },
    });

    return NextResponse.json(
      {
        ...payload,
        checksumSha256,
        requestId,
        maxExportRangeDays: MAX_EXPORT_RANGE_DAYS,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return backupApiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    logError("admin.backups.reservations.export.failed", {
      requestId,
      route,
      errorCode: "ADMIN_BACKUP_EXPORT_FAILED",
      context: {
        from: range.from,
        to: range.to,
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return backupApiError(500, {
      error: "バックアップデータの取得に失敗しました",
      code: "ADMIN_BACKUP_EXPORT_FAILED",
      requestId,
    });
  }
}
