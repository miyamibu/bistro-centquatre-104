import { NextRequest, NextResponse } from "next/server";
import { Prisma, ReservationStatus, ReservationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAuthorized } from "@/lib/basic-auth";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { updateReservationStatusSchema, zodFields } from "@/lib/validation";
import { getRequestId, logError } from "@/lib/logger";
import { createPrivateBlockAuditLog } from "@/lib/private-block-audit";
import { getClientIp, getUserAgent } from "@/lib/request-meta";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  findReservationByIdCompat,
  isReservationSchemaNotReadyError,
  updateReservationStatusCompat,
} from "@/lib/reservation-compat";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const requestId = getRequestId(request);
  const route = "/api/admin/reservations/[id]";
  const { id } = await params;

  if (!isAuthorized(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  try {
    await ensureReservationSchemaReady(prisma);

    const reservation = await findReservationByIdCompat(prisma, id);
    if (!reservation) {
      return apiError(404, { error: "Not found", code: "RESERVATION_NOT_FOUND", requestId });
    }
    return NextResponse.json(reservation);
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    logError("admin.reservation.fetch.failed", {
      requestId,
      route,
      errorCode: "ADMIN_RESERVATION_FETCH_FAILED",
      context: { id, message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to fetch reservation",
      code: "ADMIN_RESERVATION_FETCH_FAILED",
      requestId,
    });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const requestId = getRequestId(request);
  const route = "/api/admin/reservations/[id]";
  const { id } = await params;

  if (!isAuthorized(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  const ipAddress = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    await ensureReservationSchemaReady(prisma);

    const body = await request.json().catch(() => null);
    const parsed = updateReservationStatusSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, {
        error: "入力内容が不正です",
        code: "VALIDATION_ERROR",
        fields: zodFields(parsed.error),
        requestId,
      });
    }

    const operatorName = parsed.data.operatorName?.trim() || null;
    const updated = await prisma.$transaction(async (tx) => {
      const current = await findReservationByIdCompat(tx, id);
      if (!current) {
        return null;
      }

      const privateBlockReleaseRequested =
        current.reservationType === ReservationType.PRIVATE_BLOCK &&
        parsed.data.status === ReservationStatus.CANCELLED;

      if (privateBlockReleaseRequested && !operatorName) {
        throw new Error("MISSING_OPERATOR_NAME");
      }

      const next = await updateReservationStatusCompat(tx, id, parsed.data.status);
      if (!next) {
        return null;
      }

      if (privateBlockReleaseRequested) {
        await createPrivateBlockAuditLog(tx, {
          reservationId: next.id,
          date: next.date,
          servicePeriod: next.servicePeriod,
          result: "RELEASED",
          source: "ADMIN_SHARED_BASIC",
          actorName: operatorName,
          requestId,
          ipAddress,
          userAgent,
          note: null,
        });
      }

      return next;
    });

    if (!updated) {
      return apiError(404, {
        error: "Not found",
        code: "RESERVATION_NOT_FOUND",
        requestId,
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_OPERATOR_NAME") {
      return apiError(400, {
        error: "貸切解除には担当者名が必須です",
        code: "MISSING_OPERATOR_NAME",
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

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return apiError(404, {
        error: "Not found",
        code: "RESERVATION_NOT_FOUND",
        requestId,
      });
    }

    logError("admin.reservation.update.failed", {
      requestId,
      route,
      errorCode: "ADMIN_RESERVATION_UPDATE_FAILED",
      context: { id, message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to update reservation",
      code: "ADMIN_RESERVATION_UPDATE_FAILED",
      requestId,
    });
  }
}
