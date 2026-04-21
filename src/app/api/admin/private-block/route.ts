import { NextRequest, NextResponse } from "next/server";
import { Prisma, ReservationStatus, ReservationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAuthorized } from "@/lib/basic-auth";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { getRequestId, logError, logInfo } from "@/lib/logger";
import { createPrivateBlockAuditLog } from "@/lib/private-block-audit";
import {
  buildPrivateBlockReservationInput,
  evaluatePrivateBlockSubmission,
} from "@/lib/private-block";
import {
  createReservationCompat,
  ensureReservationSchemaReady,
  findReservationsCompat,
  isReservationSchemaNotReadyError,
  RESERVATION_SCHEMA_NOT_READY_CODE,
} from "@/lib/reservation-compat";
import { createAdminPrivateBlockSchema, zodFields } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/admin/private-block";

  if (!isAuthorized(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  try {
    await ensureReservationSchemaReady(prisma);
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    logError("admin.private_block.schema_check.failed", {
      requestId,
      route,
      errorCode: "RESERVATION_SCHEMA_CHECK_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to initialize reservation schema",
      code: "RESERVATION_SCHEMA_CHECK_FAILED",
      requestId,
    });
  }

  const body = await request.json().catch(() => null);
  const parsed = createAdminPrivateBlockSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      fields: zodFields(parsed.error),
      requestId,
    });
  }

  const { date, servicePeriod, note } = parsed.data;
  const normalizedNote = note?.trim() || undefined;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const confirmed = await findReservationsCompat(tx, {
          where: {
            date,
            servicePeriod,
            status: ReservationStatus.CONFIRMED,
          },
          orderBy: [{ createdAt: "asc" }],
        });

        const action = evaluatePrivateBlockSubmission(
          confirmed.map((reservation) => ({
            reservationType: reservation.reservationType,
            status: reservation.status,
          }))
        );

        if (action === "NO_OP") {
          const existingPrivateBlock = confirmed.find(
            (reservation) => reservation.reservationType === ReservationType.PRIVATE_BLOCK
          );
          if (!existingPrivateBlock) {
            throw new Error("PRIVATE_BLOCK_STATE_INVALID");
          }

          await createPrivateBlockAuditLog(tx, {
            reservationId: existingPrivateBlock.id,
            date,
            servicePeriod,
            result: "NO_OP",
            source: "ADMIN_SHARED_BASIC",
            requestId,
            note: normalizedNote ?? null,
          });

          return {
            result: "NO_OP" as const,
            reservationId: existingPrivateBlock.id,
          };
        }

        if (action === "CONFLICT") {
          throw new Error("PRIVATE_BLOCK_CONFLICT");
        }

        const created = await createReservationCompat(
          tx,
          buildPrivateBlockReservationInput({
            date,
            servicePeriod,
            note: normalizedNote,
          })
        );

        await createPrivateBlockAuditLog(tx, {
          reservationId: created.id,
          date,
          servicePeriod,
          result: "CREATED",
          source: "ADMIN_SHARED_BASIC",
          requestId,
          note: normalizedNote ?? null,
        });

        return {
          result: "CREATE" as const,
          reservationId: created.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    logInfo("admin.private_block.saved", {
      requestId,
      route,
      context: {
        date,
        servicePeriod,
        result: result.result,
        reservationId: result.reservationId,
      },
    });

    return NextResponse.json(
      {
        result: result.result,
        reservationId: result.reservationId,
        summary:
          result.result === "CREATE"
            ? `${servicePeriod === "LUNCH" ? "ランチ" : "ディナー"}の貸切営業を設定しました。`
            : "この時間帯は既に貸切営業です。",
        requestId,
      },
      { status: result.result === "CREATE" ? 201 : 200 }
    );
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message === "PRIVATE_BLOCK_CONFLICT") {
      return apiError(409, {
        result: "CONFLICT",
        error: "通常予約が存在するため貸切設定できません",
        code: "CONFLICT",
        requestId,
      });
    }

    const isRetryable =
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002")) ||
      message.includes("could not serialize");

    if (isRetryable) {
      return apiError(409, {
        error: "予約処理が競合しました。時間をおいて再度お試しください。",
        code: "RESERVATION_CONFLICT",
        requestId,
      });
    }

    logError("admin.private_block.save.failed", {
      requestId,
      route,
      errorCode: "ADMIN_PRIVATE_BLOCK_SAVE_FAILED",
      context: { date, servicePeriod, message },
    });
    return apiError(500, {
      error: "貸切設定に失敗しました",
      code: "ADMIN_PRIVATE_BLOCK_SAVE_FAILED",
      requestId,
    });
  }
}
