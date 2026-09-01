import { NextRequest, NextResponse } from "next/server";
import { Prisma, ReservationStatus, ReservationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStaffAuth } from "@/lib/staff-auth";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { getClientIp, getUserAgent, hashAuditIp } from "@/lib/request-meta";
import { getRequestId, logError } from "@/lib/logger";
import { acquireReservationAdvisoryLock } from "@/lib/reservation-advisory-lock";
import { evaluateReservationAvailability } from "@/lib/reservation-capacity";
import { isArrivalTimeAllowed, isCourseServicePeriodConsistent } from "@/lib/booking-rules";
import { normalizeReservationName, normalizeReservationPhone } from "@/lib/reservation-dedup";
import {
  ensureReservationSchemaReady,
  isReservationSchemaNotReadyError,
  RESERVATION_SCHEMA_NOT_READY_CODE,
} from "@/lib/reservation-compat";
import { parseReservationNote } from "@/lib/reservation-note";
import { updateAdminReservationSchema, zodFields } from "@/lib/validation";
import { scheduleAfterResponse } from "@/lib/after-response";
import {
  enqueueReservationChangedEmail,
  processReservationEmailOutboxEntries,
  ReservationEmailOutboxBusyError,
} from "@/lib/reservation-email-outbox";
import {
  enqueueReservationLineLifecycle,
  processReservationLineLifecycleEvent,
} from "@/lib/reservation-line-outbox";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function correctionError(message: string, code: string, requestId: string, status = 409) {
  return apiError(status, { error: message, code, requestId });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const requestId = getRequestId(request);
  const id = (await params).id;
  const staffAuth = await getStaffAuth();
  if (!staffAuth) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  const body = await request.json().catch(() => null);
  const parsed = updateAdminReservationSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      fields: zodFields(parsed.error),
      requestId,
    });
  }

  const ipAddress = hashAuditIp(getClientIp(request));
  const userAgent = getUserAgent(request);

  try {
    await ensureReservationSchemaReady(prisma);

    const result = await prisma.$transaction(
      async (tx) => {
        const current = await tx.reservation.findUnique({ where: { id } });
        if (!current) throw new Error("RESERVATION_NOT_FOUND");
        if (
          parsed.data.expectedUpdatedAt &&
          current.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt
        ) {
          throw new Error("RESERVATION_CORRECTION_CONFLICT");
        }
        if (current.reservationType !== ReservationType.NORMAL) {
          throw new Error("RESERVATION_CORRECTION_TYPE_NOT_ALLOWED");
        }

        const targetDate = parsed.data.date ?? current.date;
        const targetServicePeriod = parsed.data.servicePeriod ?? current.servicePeriod;
        const targetPartySize = parsed.data.partySize ?? current.partySize;
        const targetArrivalTime =
          parsed.data.arrivalTime !== undefined ? parsed.data.arrivalTime : current.arrivalTime;
        const targetName = parsed.data.name ?? current.name;
        const targetPhone = parsed.data.phone ?? current.phone;
        const targetNote = parsed.data.note !== undefined ? parsed.data.note : current.note;
        const targetCourse = parseReservationNote(targetNote).course;
        const slotChanged =
          targetDate !== current.date ||
          targetServicePeriod !== current.servicePeriod ||
          targetPartySize !== current.partySize;
        const arrivalChanged = targetArrivalTime !== current.arrivalTime;
        const duplicateFieldsChanged =
          slotChanged ||
          arrivalChanged ||
          targetName !== current.name ||
          targetPhone !== current.phone;

        const lockTargets = [
          [current.date, current.servicePeriod],
          [targetDate, targetServicePeriod],
        ]
          .map(([date, servicePeriod]) => `${date}:${servicePeriod}`)
          .filter((value, index, values) => values.indexOf(value) === index)
          .sort();
        for (const lockTarget of lockTargets) {
          const [date, servicePeriod] = lockTarget.split(":");
          await acquireReservationAdvisoryLock(tx, date, servicePeriod);
        }

        if (
          current.status !== ReservationStatus.CONFIRMED &&
          (targetDate !== current.date ||
            targetServicePeriod !== current.servicePeriod ||
            targetPartySize !== current.partySize)
        ) {
          throw new Error("RESERVATION_CORRECTION_ACTIVE_STATUS_REQUIRED");
        }

        if (
          !isCourseServicePeriodConsistent(targetCourse, targetServicePeriod) ||
          (targetArrivalTime !== null &&
            (!isArrivalTimeAllowed(targetArrivalTime, targetCourse, targetServicePeriod) ||
              (arrivalChanged && !targetArrivalTime))) ||
          ((slotChanged || arrivalChanged) && !targetArrivalTime)
        ) {
          throw new Error("INVALID_CORRECTION_ARRIVAL_TIME");
        }

        const businessDay = slotChanged
          ? await tx.businessDay.findUnique({ where: { date: targetDate } })
          : null;
        const confirmed = duplicateFieldsChanged
          ? await tx.reservation.findMany({
              where: {
                date: targetDate,
                servicePeriod: targetServicePeriod,
                status: ReservationStatus.CONFIRMED,
                id: { not: current.id },
              },
              select: {
                id: true,
                partySize: true,
                status: true,
                servicePeriod: true,
                reservationType: true,
                arrivalTime: true,
                name: true,
                phone: true,
              },
            })
          : [];

        if (slotChanged) {
          const availability = evaluateReservationAvailability({
            date: targetDate,
            servicePeriod: targetServicePeriod,
            partySize: targetPartySize,
            existingReservations: confirmed,
            businessDayClosed: businessDay?.isClosed,
            skipPublicBookingWindow: true,
          });
          if (availability.reason !== "OK") {
            throw new Error(`CORRECTION_AVAILABILITY_${availability.reason}`);
          }
        }

        const duplicate = duplicateFieldsChanged && confirmed.some(
          (reservation) =>
            reservation.reservationType === ReservationType.NORMAL &&
            reservation.arrivalTime === targetArrivalTime &&
            reservation.partySize === targetPartySize &&
            normalizeReservationName(reservation.name) === normalizeReservationName(targetName) &&
            normalizeReservationPhone(reservation.phone) === normalizeReservationPhone(targetPhone),
        );
        if (duplicate) throw new Error("CORRECTION_DUPLICATE_RESERVATION");

        const fields = {
          date: targetDate,
          servicePeriod: targetServicePeriod,
          partySize: targetPartySize,
          arrivalTime: targetArrivalTime,
          name: targetName,
          phone: targetPhone,
          note: targetNote,
        } as const;
        const beforeData: Record<string, unknown> = {};
        const afterData: Record<string, unknown> = {};
        const updateData: Record<string, unknown> = {};
        for (const [field, nextValue] of Object.entries(fields)) {
          const previousValue = current[field as keyof typeof fields];
          if (previousValue !== nextValue) {
            beforeData[field] = previousValue;
            afterData[field] = nextValue;
            updateData[field] = nextValue;
          }
        }

        if (Object.keys(updateData).length === 0) {
          return { current, next: current, changed: false, emailOutboxId: null, lineEventId: null };
        }

        const updatedCount = await tx.reservation.updateMany({
          where: { id: current.id, updatedAt: current.updatedAt },
          data: updateData,
        });
        if (updatedCount.count !== 1) throw new Error("RESERVATION_CORRECTION_CONFLICT");

        const next = await tx.reservation.findUnique({ where: { id: current.id } });
        if (!next) throw new Error("RESERVATION_NOT_FOUND");

        await tx.reservationCorrectionAuditLog.create({
          data: {
            reservationId: next.id,
            actorName: staffAuth.email ?? staffAuth.userId,
            actorUserId: staffAuth.userId,
            actorEmail: staffAuth.email,
            actorRole: staffAuth.role,
            requestId,
            ipAddress,
            userAgent,
            reason: parsed.data.reason,
            beforeData: beforeData as Prisma.InputJsonValue,
            afterData: afterData as Prisma.InputJsonValue,
          },
        });

        const emailOutbox = next.customerEmail
          ? await enqueueReservationChangedEmail(tx, next.id)
          : null;
        const lineEvent = await enqueueReservationLineLifecycle(tx, {
          reservationId: next.id,
          lineUserId: next.lineUserId,
          type: "RESERVATION_CHANGED",
          eventKey: next.updatedAt.toISOString(),
        });

        return {
          current,
          next,
          changed: true,
          emailOutboxId: emailOutbox?.id ?? null,
          lineEventId: lineEvent?.id ?? null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.emailOutboxId || result.lineEventId) {
      scheduleAfterResponse(async () => {
        if (result.emailOutboxId) {
          await processReservationEmailOutboxEntries({
            ids: [result.emailOutboxId],
            requestId: `${requestId}:correction-email`,
          });
        }
        if (result.lineEventId) {
          await processReservationLineLifecycleEvent(
            result.lineEventId,
            "ADMIN_CORRECTION",
          );
        }
      });
    }
    return NextResponse.json({ ...result.next, correctionChanged: result.changed, requestId });
  } catch (error) {
    if (error instanceof ReservationEmailOutboxBusyError) {
      return correctionError(
        "予約変更通知を送信中です。完了後にもう一度訂正してください",
        error.code,
        requestId,
      );
    }
    if (error instanceof Error && error.message === "RESERVATION_NOT_FOUND") {
      return correctionError("予約が見つかりません", "RESERVATION_NOT_FOUND", requestId, 404);
    }
    if (error instanceof Error && error.message === "RESERVATION_CORRECTION_CONFLICT") {
      return correctionError(
        "予約が別の操作で更新されました。最新状態を確認してから再度訂正してください",
        "RESERVATION_CORRECTION_CONFLICT",
        requestId,
      );
    }
    if (error instanceof Error && error.message === "RESERVATION_CORRECTION_TYPE_NOT_ALLOWED") {
      return correctionError(
        "貸切レコードは通常予約の訂正画面から変更できません",
        "RESERVATION_CORRECTION_TYPE_NOT_ALLOWED",
        requestId,
        400,
      );
    }
    if (error instanceof Error && error.message === "RESERVATION_CORRECTION_ACTIVE_STATUS_REQUIRED") {
      return correctionError(
        "確定済み予約だけ日時・時間帯・人数を訂正できます",
        "RESERVATION_CORRECTION_ACTIVE_STATUS_REQUIRED",
        requestId,
        409,
      );
    }
    if (error instanceof Error && error.message === "INVALID_CORRECTION_ARRIVAL_TIME") {
      return correctionError(
        "時間帯と来店目安の組み合わせが不正です",
        "INVALID_CORRECTION_ARRIVAL_TIME",
        requestId,
        400,
      );
    }
    if (error instanceof Error && error.message === "CORRECTION_DUPLICATE_RESERVATION") {
      return correctionError(
        "同じ日時・氏名・電話番号・人数の確定予約が既にあります",
        "CORRECTION_DUPLICATE_RESERVATION",
        requestId,
        409,
      );
    }
    if (error instanceof Error && error.message.startsWith("CORRECTION_AVAILABILITY_")) {
      return correctionError(
        "訂正後の予約が営業時間、休業、貸切、席数の条件に適合しません",
        error.message,
        requestId,
        409,
      );
    }
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    logError("admin.reservation.correction.failed", {
      requestId,
      route: "/api/admin/reservations/[id]/correction",
      errorCode: "ADMIN_RESERVATION_CORRECTION_FAILED",
      context: { id, message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "予約訂正に失敗しました",
      code: "ADMIN_RESERVATION_CORRECTION_FAILED",
      requestId,
    });
  }
}
