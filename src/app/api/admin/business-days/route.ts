import { NextRequest, NextResponse } from "next/server";
import { Prisma, ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStaffAuth } from "@/lib/staff-auth";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { dateStringSchema, upsertBusinessDaySchema, zodFields } from "@/lib/validation";
import { getClientIp, getUserAgent } from "@/lib/request-meta";
import { getRequestId, logError, logInfo } from "@/lib/logger";
import {
  ensureReservationSchemaReady,
  findReservationsCompat,
  isReservationSchemaNotReadyError,
  RESERVATION_SCHEMA_NOT_READY_CODE,
} from "@/lib/reservation-compat";
import { acquireReservationAdvisoryLock } from "@/lib/reservation-advisory-lock";

export const dynamic = "force-dynamic";

class BusinessDayConfirmedReservationsError extends Error {
  constructor(
    readonly reservationCount: number,
    readonly partyTotal: number,
    readonly privateBlockCount: number,
  ) {
    super("BUSINESS_DAY_CONFIRMED_RESERVATIONS");
    this.name = "BusinessDayConfirmedReservationsError";
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  const staffAuth = await getStaffAuth();
  if (!staffAuth) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  try {
    const date = request.nextUrl.searchParams.get("date");
    if (date) {
      const parsedDate = dateStringSchema.safeParse(date);
      if (!parsedDate.success) {
        return apiError(400, {
          error: "入力内容が不正です",
          code: "VALIDATION_ERROR",
          fields: zodFields(parsedDate.error),
          requestId,
        });
      }

      const day = await prisma.businessDay.findUnique({ where: { date: parsedDate.data } });
      return NextResponse.json({
        ...(day ?? { date: parsedDate.data, isClosed: false }),
        permissions: { canManageBusinessDays: staffAuth.role === "ADMIN" },
      });
    }
    const days = await prisma.businessDay.findMany({ orderBy: { date: "asc" } });
    return NextResponse.json(days);
  } catch (error) {
    logError("admin.business_days.fetch.failed", {
      requestId,
      route: "/api/admin/business-days",
      errorCode: "BUSINESS_DAYS_FETCH_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to fetch business days",
      code: "BUSINESS_DAYS_FETCH_FAILED",
      requestId,
    });
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const staffAuth = await getStaffAuth("ADMIN");

  if (!staffAuth) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  try {
    const body = await request.json().catch(() => null);
    const parsed = upsertBusinessDaySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, {
        error: "入力内容が不正です",
        code: "VALIDATION_ERROR",
        fields: zodFields(parsed.error),
        requestId,
      });
    }

    const { date, isClosed, note } = parsed.data;
    const reason = parsed.data.reason?.trim() || note?.trim() || null;
    const ipAddress = getClientIp(request);
    const userAgent = getUserAgent(request);
    const saved = await prisma.$transaction(
      async (tx) => {
        await acquireReservationAdvisoryLock(tx, date, "LUNCH");
        await acquireReservationAdvisoryLock(tx, date, "DINNER");

        await ensureReservationSchemaReady(tx);
        const confirmed = await findReservationsCompat(tx, {
          where: { date, status: ReservationStatus.CONFIRMED },
          select: { partySize: true, reservationType: true },
        });
        const partyTotal = confirmed.reduce((sum, row) => sum + row.partySize, 0);
        const privateBlockCount = confirmed.filter(
          (row) => row.reservationType === "PRIVATE_BLOCK"
        ).length;

        if (isClosed && confirmed.length > 0 && !parsed.data.force) {
          throw new BusinessDayConfirmedReservationsError(
            confirmed.length,
            partyTotal,
            privateBlockCount,
          );
        }

        if (isClosed && confirmed.length > 0 && !reason) {
          throw new Error("BUSINESS_DAY_FORCE_REASON_REQUIRED");
        }

        const previous = await tx.businessDay.findUnique({ where: { date } });
        const savedDay = await tx.businessDay.upsert({
          where: { date },
          update: { isClosed, note: note ?? null },
          create: { date, isClosed, note: note ?? null },
        });

        await tx.businessDayAuditLog.create({
          data: {
            businessDayId: savedDay.id,
            date,
            previousIsClosed: previous?.isClosed ?? null,
            nextIsClosed: savedDay.isClosed,
            previousNote: previous?.note ?? null,
            nextNote: savedDay.note,
            actorName: staffAuth.email ?? staffAuth.userId,
            actorUserId: staffAuth.userId,
            actorEmail: staffAuth.email,
            actorRole: staffAuth.role,
            requestId,
            ipAddress,
            userAgent,
            reason,
          },
        });

        return savedDay;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    logInfo("admin.business_days.saved", {
      requestId,
      route: "/api/admin/business-days",
      context: { date, isClosed, force: parsed.data.force, actorUserId: staffAuth.userId },
    });

    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof BusinessDayConfirmedReservationsError) {
      return apiError(409, {
        error: "確定済み予約があるため、先に予約の扱いを確認してください。",
        code: "BUSINESS_DAY_CONFIRMED_RESERVATIONS",
        reservationCount: error.reservationCount,
        partyTotal: error.partyTotal,
        privateBlockCount: error.privateBlockCount,
        requestId,
      });
    }

    if (error instanceof Error && error.message === "BUSINESS_DAY_FORCE_REASON_REQUIRED") {
      return apiError(400, {
        error: "既存予約がある日の強制休業には理由が必要です。",
        code: "BUSINESS_DAY_FORCE_REASON_REQUIRED",
        requestId,
      });
    }

    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    logError("admin.business_days.save.failed", {
      requestId,
      route: "/api/admin/business-days",
      errorCode: "BUSINESS_DAYS_SAVE_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to save business day",
      code: "BUSINESS_DAYS_SAVE_FAILED",
      requestId,
    });
  }
}
