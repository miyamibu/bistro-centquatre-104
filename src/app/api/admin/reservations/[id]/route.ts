import { NextRequest, NextResponse } from "next/server";
import { Prisma, ReservationStatus, ReservationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStaffAuth } from "@/lib/staff-auth";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { updateReservationStatusSchema, zodFields } from "@/lib/validation";
import { getRequestId, logError, logInfo } from "@/lib/logger";
import { createPrivateBlockAuditLog } from "@/lib/private-block-audit";
import {
  enqueueReservationStatusEmail,
  suppressReservationConfirmationEmail,
} from "@/lib/reservation-email-outbox";
import { getClientIp, getUserAgent, hashClientIp } from "@/lib/request-meta";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  findReservationByIdCompat,
  isReservationSchemaNotReadyError,
  updateReservationStatusCompat,
} from "@/lib/reservation-compat";
import {
  evaluateReservationStatusTransition,
  requiresOperatorForReservationStatusTransition,
} from "@/lib/reservation-status";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

type ReservationTargetInput = {
  date?: string;
  servicePeriod?: "LUNCH" | "DINNER";
  reservationType?: ReservationType;
  expectedDate?: string;
  expectedServicePeriod?: "LUNCH" | "DINNER";
  expectedReservationType?: ReservationType;
  expected?: {
    date: string;
    servicePeriod: "LUNCH" | "DINNER";
    reservationType: ReservationType;
  };
};

function getExpectedReservationTarget(input: ReservationTargetInput) {
  return {
    date: input.expected?.date ?? input.expectedDate ?? input.date,
    servicePeriod:
      input.expected?.servicePeriod ?? input.expectedServicePeriod ?? input.servicePeriod,
    reservationType:
      input.expected?.reservationType ?? input.expectedReservationType ?? input.reservationType,
  };
}

function hasAnyExpectedReservationTarget(
  target: ReturnType<typeof getExpectedReservationTarget>
) {
  return Boolean(target.date || target.servicePeriod || target.reservationType);
}

function hasCompleteExpectedReservationTarget(
  target: ReturnType<typeof getExpectedReservationTarget>
) {
  return Boolean(target.date && target.servicePeriod && target.reservationType);
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const requestId = getRequestId(request);
  const route = "/api/admin/reservations/[id]";
  const { id } = await params;

  const staffAuth = await getStaffAuth();
  if (!staffAuth) {
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

  const staffAuth = await getStaffAuth();
  if (!staffAuth) {
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

    const operatorLabel = parsed.data.operatorName?.trim() || null;
    const reason = parsed.data.reason?.trim() || null;
    const updated = await prisma.$transaction(async (tx) => {
      const current = await findReservationByIdCompat(tx, id);
      if (!current) {
        return null;
      }

      if (current.status === parsed.data.status) {
        return { current, next: current };
      }

      const privateBlockReleaseRequested =
        current.reservationType === ReservationType.PRIVATE_BLOCK &&
        parsed.data.status === ReservationStatus.CANCELLED;
      const transition = evaluateReservationStatusTransition({
        reservationType: current.reservationType,
        currentStatus: current.status,
        nextStatus: parsed.data.status,
      });

      if (transition === "TERMINAL_STATUS_NOT_ALLOWED") {
        throw new Error("TERMINAL_STATUS_TRANSITION_NOT_ALLOWED");
      }

      if (transition === "RESERVATION_TYPE_NOT_ALLOWED") {
        throw new Error("RESERVATION_STATUS_TRANSITION_NOT_ALLOWED");
      }

      const expectedTarget = getExpectedReservationTarget(parsed.data);
      const hasExpectedTarget = hasAnyExpectedReservationTarget(expectedTarget);
      const hasCompleteExpectedTarget = hasCompleteExpectedReservationTarget(expectedTarget);

      if (privateBlockReleaseRequested && !hasCompleteExpectedTarget) {
        throw new Error("PRIVATE_BLOCK_TARGET_REQUIRED");
      }

      if (hasExpectedTarget && !hasCompleteExpectedTarget) {
        throw new Error("INVALID_RESERVATION_TARGET");
      }

      if (
        hasCompleteExpectedTarget &&
        (current.date !== expectedTarget.date ||
          current.servicePeriod !== expectedTarget.servicePeriod ||
          current.reservationType !== expectedTarget.reservationType)
      ) {
        throw new Error("RESERVATION_TARGET_MISMATCH");
      }

      if (
        requiresOperatorForReservationStatusTransition({
          reservationType: current.reservationType,
          currentStatus: current.status,
          nextStatus: parsed.data.status,
        }) &&
        !operatorLabel
      ) {
        throw new Error("MISSING_OPERATOR_NAME");
      }

      if (
        new Set<ReservationStatus>([
          ReservationStatus.CANCELLED,
          ReservationStatus.DONE,
          ReservationStatus.NOSHOW,
        ]).has(parsed.data.status) &&
        !reason
      ) {
        throw new Error("MISSING_STATUS_REASON");
      }

      const next = await updateReservationStatusCompat(tx, id, current.status, parsed.data.status);
      if (!next) {
        throw new Error("RESERVATION_STATUS_CONFLICT");
      }

      await tx.reservationStatusAuditLog.create({
        data: {
          reservationId: next.id,
          actorName: staffAuth.email ?? staffAuth.userId,
          actorUserId: staffAuth.userId,
          actorEmail: staffAuth.email,
          actorRole: staffAuth.role,
          operatorLabel,
          requestId,
          ipAddress,
          userAgent,
          previousStatus: current.status,
          nextStatus: next.status,
          reason,
        },
      });

      if (next.status === ReservationStatus.CANCELLED) {
        await suppressReservationConfirmationEmail(tx, next.id);
      }

      if (
        next.reservationType === ReservationType.NORMAL &&
        (next.status === ReservationStatus.CANCELLED || next.status === ReservationStatus.NOSHOW)
      ) {
        await enqueueReservationStatusEmail(tx, next.id, next.status);
      }

      if (privateBlockReleaseRequested) {
        await createPrivateBlockAuditLog(tx, {
          reservationId: next.id,
          date: next.date,
          servicePeriod: next.servicePeriod,
          result: "RELEASED",
          source: "ADMIN_USER",
          actorName: staffAuth.email ?? staffAuth.userId,
          actorUserId: staffAuth.userId,
          actorEmail: staffAuth.email,
          actorRole: staffAuth.role,
          operatorLabel,
          requestId,
          ipAddress,
          userAgent,
          note: reason ?? "PRIVATE_BLOCK_RELEASE",
        });
      }

      return { current, next };
    });

    if (!updated) {
      return apiError(404, {
        error: "Not found",
        code: "RESERVATION_NOT_FOUND",
        requestId,
      });
    }

    logInfo("admin.reservation.status.updated", {
      requestId,
      route,
      context: {
        reservationId: updated.next.id,
        reservationType: updated.next.reservationType,
        previousStatus: updated.current.status,
        nextStatus: updated.next.status,
        date: updated.next.date,
        servicePeriod: updated.next.servicePeriod,
        operatorLabel,
        ipHash: hashClientIp(ipAddress),
        userAgent,
        privateBlockReleaseRequested:
          updated.current.reservationType === ReservationType.PRIVATE_BLOCK &&
          updated.next.status === ReservationStatus.CANCELLED,
      },
    });

    return NextResponse.json(updated.next);
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_OPERATOR_NAME") {
      return apiError(400, {
        error: "貸切解除には担当者名が必須です",
        code: "MISSING_OPERATOR_NAME",
        requestId,
      });
    }

    if (error instanceof Error && error.message === "MISSING_STATUS_REASON") {
      return apiError(400, {
        error: "終端ステータスへの変更には理由が必要です",
        code: "MISSING_STATUS_REASON",
        requestId,
      });
    }

    if (error instanceof Error && error.message === "PRIVATE_BLOCK_TARGET_REQUIRED") {
      return apiError(400, {
        error: "貸切解除には対象のdate、servicePeriod、reservationTypeが必要です",
        code: "PRIVATE_BLOCK_TARGET_REQUIRED",
        requestId,
      });
    }

    if (error instanceof Error && error.message === "INVALID_RESERVATION_TARGET") {
      return apiError(400, {
        error: "対象確認情報が不足しています",
        code: "INVALID_RESERVATION_TARGET",
        requestId,
      });
    }

    if (error instanceof Error && error.message === "RESERVATION_TARGET_MISMATCH") {
      return apiError(409, {
        error: "対象の予約情報が現在の状態と一致しません。最新状態を確認してください",
        code: "RESERVATION_TARGET_MISMATCH",
        requestId,
      });
    }

    if (error instanceof Error && error.message === "RESERVATION_STATUS_TRANSITION_NOT_ALLOWED") {
      return apiError(409, {
        error: "貸切レコードはキャンセル以外の終端状態へ変更できません",
        code: "RESERVATION_STATUS_TRANSITION_NOT_ALLOWED",
        requestId,
      });
    }

    if (error instanceof Error && error.message === "TERMINAL_STATUS_TRANSITION_NOT_ALLOWED") {
      return apiError(409, {
        error: "終端状態の予約はこの画面から再変更できません",
        code: "TERMINAL_STATUS_TRANSITION_NOT_ALLOWED",
        requestId,
      });
    }

    if (error instanceof Error && error.message === "RESERVATION_STATUS_CONFLICT") {
      return apiError(409, {
        error: "予約の状態が別の操作で変更されたため、更新できません。最新状態を確認してください",
        code: "RESERVATION_STATUS_CONFLICT",
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
