import { NextRequest, NextResponse } from "next/server";
import { Prisma, ReservationStatus, ReservationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  availabilityReasonToError,
  isArrivalTimeValid,
  isCoursePeriodConsistent,
} from "@/lib/availability";
import { sendReservationEmail } from "@/lib/email";
import {
  enforceReservationWriteRateLimit,
  isReservationRateLimitError,
} from "@/lib/reservation-rate-limit";
import { buildReservationAdvisoryLockKey } from "@/lib/reservation-lock";
import { evaluateReservationAvailability } from "@/lib/reservation-capacity";
import { getClientIp, hashClientIp } from "@/lib/request-meta";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  createReservationCompat,
  findReservationsCompat,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";
import {
  buildReservationDuplicateWindowStart,
  isDuplicateReservationCandidate,
} from "@/lib/reservation-dedup";
import { createReservationSchema, zodFields } from "@/lib/validation";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { getContactPayload } from "@/lib/contact";
import { env } from "@/lib/env";
import { canPushToLineUser, verifyLineIdToken } from "@/lib/line";
import { getRequestId, logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

const RETRIES = 3;

async function acquireReservationAdvisoryLock(
  tx: Prisma.TransactionClient,
  date: string,
  servicePeriod: string
) {
  const lockKey = buildReservationAdvisoryLockKey(date, servicePeriod);
  await tx.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    lockKey
  );
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const contact = getContactPayload();
  const body = await request.json().catch(() => null);

  const securityError = enforceWriteRequestSecurity(request, {
    requestId,
    requireRequestedWith: false,
  });
  if (securityError) return securityError;

  if (body?.reservationType === ReservationType.PRIVATE_BLOCK) {
    return apiError(403, {
      error: "貸切設定は公開予約フォームからは行えません",
      code: "PRIVATE_BLOCK_PUBLIC_DISABLED",
      requestId,
      ...contact,
    });
  }

  try {
    await ensureReservationSchemaReady(prisma);
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
          error: "予約システムの準備が完了していません",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
        ...contact,
      });
    }

    logError("reservation.schema_check.failed", {
      requestId,
      route: "/api/reservations",
      errorCode: "RESERVATION_SCHEMA_CHECK_FAILED",
      context: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return apiError(500, {
      error: "予約処理の初期化に失敗しました",
      code: "RESERVATION_SCHEMA_CHECK_FAILED",
      requestId,
      ...contact,
    });
  }

  const ipAddress = getClientIp(request);
  const ipHash = hashClientIp(ipAddress);

  try {
    await enforceReservationWriteRateLimit(prisma, {
      ipHash,
    });
  } catch (error) {
    if (isReservationRateLimitError(error)) {
      return apiError(429, {
        error: error.message,
        code: error.code,
        requestId,
        ...contact,
      });
    }

    logError("reservation.rate_limit.failed", {
      requestId,
      route: "/api/reservations",
      errorCode: "RATE_LIMIT_CHECK_FAILED",
      context: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return apiError(500, {
      error: "予約処理の初期化に失敗しました",
      code: "RATE_LIMIT_CHECK_FAILED",
      requestId,
      ...contact,
    });
  }

  const parsed = createReservationSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      fields: zodFields(parsed.error),
      requestId,
      ...contact,
    });
  }

  const {
    date,
    servicePeriod,
    partySize,
    arrivalTime,
    name,
    phone,
    note,
    lineIdToken,
    course,
  } = parsed.data;
  const reservationNote =
    [course ? `コース: ${course}` : null, note].filter(Boolean).join("\n") || null;

  // クライアントから lineUserId が来ても保存しない。LIFF ID token のみ信用する。
  let verifiedLineUserId: string | null = null;
  if (typeof lineIdToken === "string" && lineIdToken.length > 0) {
    try {
      const sub = await verifyLineIdToken(lineIdToken);
      if (sub) {
        const pushable = await canPushToLineUser(sub);
        if (pushable) {
          verifiedLineUserId = sub;
        } else {
          logInfo("reservation.line.not_pushable", {
            requestId,
            route: "/api/reservations",
          });
        }
      } else {
        logInfo("reservation.line.verify_failed", {
          requestId,
          route: "/api/reservations",
        });
      }
    } catch (lineError) {
      // LINE 通知の失敗で予約作成全体を落とさない。
      logError("reservation.line.unexpected_error", {
        requestId,
        route: "/api/reservations",
        errorCode: "LINE_VERIFY_UNEXPECTED",
        context: {
          message:
            lineError instanceof Error ? lineError.message : String(lineError),
        },
      });
    }
  }

  if (!isArrivalTimeValid(arrivalTime, servicePeriod)) {
    return apiError(400, {
      error: "選択した時間帯の予約可能な来店時間を選択してください",
      code: "INVALID_ARRIVAL_TIME",
      requestId,
      ...contact,
    });
  }

  if (!isCoursePeriodConsistent(course, servicePeriod)) {
    return apiError(400, {
      error: "コースの時間帯とご来店時間帯が一致していません",
      code: "COURSE_TIME_MISMATCH",
      requestId,
      ...contact,
    });
  }

  const initialBusinessDay = await prisma.businessDay.findUnique({ where: { date } });
  const initialAvailability = evaluateReservationAvailability({
    date,
    servicePeriod,
    partySize,
    existingReservations: [],
    businessDayClosed: initialBusinessDay?.isClosed,
  });

  if (initialAvailability.reason !== "OK" && initialAvailability.reason !== "PHONE_ONLY") {
    const mapped = availabilityReasonToError(initialAvailability.reason);
    return apiError(mapped.status, {
      error: mapped.error,
      code: mapped.code,
      requestId,
      ...contact,
    });
  }

  if (initialAvailability.reason === "PHONE_ONLY") {
    const mapped = availabilityReasonToError("PHONE_ONLY");
    return apiError(mapped.status, {
      error: mapped.error,
      code: mapped.code,
      requestId,
      ...contact,
    });
  }

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const now = new Date();
      const result = await prisma.$transaction(
        async (tx) => {
          await acquireReservationAdvisoryLock(tx, date, servicePeriod);

          const businessDay = await tx.businessDay.findUnique({ where: { date } });
          const confirmed = await findReservationsCompat(tx, {
            where: {
              date,
              servicePeriod,
              status: ReservationStatus.CONFIRMED,
            },
          });
          const duplicateWindowStart = buildReservationDuplicateWindowStart(now);
          const duplicateReservation = confirmed.find(
            (reservation) =>
              reservation.arrivalTime === arrivalTime &&
              reservation.createdAt >= duplicateWindowStart &&
              isDuplicateReservationCandidate(reservation, {
                name,
                phone,
                partySize,
              })
          );
          if (duplicateReservation) {
            return {
              reservation: duplicateReservation,
              deduplicated: true,
            };
          }

          const availability = evaluateReservationAvailability({
            date,
            servicePeriod,
            partySize,
            existingReservations: confirmed.map((reservation) => ({
              partySize: reservation.partySize,
              status: reservation.status,
              servicePeriod: reservation.servicePeriod,
              reservationType: reservation.reservationType,
            })),
            businessDayClosed: businessDay?.isClosed,
          });

          if (availability.reason !== "OK") {
            throw new Error(availability.reason);
          }

          const createdReservation = await createReservationCompat(tx, {
            date,
            servicePeriod,
            reservationType: ReservationType.NORMAL,
            seatType: "MAIN",
            partySize,
            arrivalTime,
            name,
            phone,
            note: reservationNote,
            status: ReservationStatus.CONFIRMED,
            lineUserId: verifiedLineUserId,
          });

          return {
            reservation: createdReservation,
            deduplicated: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      const { reservation, deduplicated } = result;

      const adminLink = env.BASE_URL ? `${env.BASE_URL}/admin/reservations/${reservation.id}` : "";
      if (!deduplicated) {
        sendReservationEmail({ reservation, adminUrl: adminLink }).catch((err) => {
          logError("reservation.email.failed", {
            requestId,
            route: "/api/reservations",
            errorCode: "EMAIL_SEND_FAILED",
            context: {
              reservationId: reservation.id,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        });
      }

      logInfo(deduplicated ? "reservation.deduplicated" : "reservation.created", {
        requestId,
        route: "/api/reservations",
        context: {
          reservationId: reservation.id,
          date: reservation.date,
          servicePeriod: reservation.servicePeriod,
          partySize: reservation.partySize,
          deduplicated,
        },
      });

      return NextResponse.json({
        reservationId: reservation.id,
        summary: `${reservation.date} ${reservation.servicePeriod === "LUNCH" ? "ランチ" : "ディナー"} ${reservation.partySize}名で承りました。`,
        adminLink: adminLink || undefined,
        deduplicated,
        lineNotification: {
          enabled: verifiedLineUserId !== null,
        },
        requestId,
      });
    } catch (error: unknown) {
      if (isReservationSchemaNotReadyError(error)) {
        return apiError(503, {
            error: "予約システムの準備が完了していません",
          code: RESERVATION_SCHEMA_NOT_READY_CODE,
          requestId,
          ...contact,
        });
      }

      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
      const isRetryable =
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") ||
        message.includes("could not serialize");

      if (isRetryable && attempt < RETRIES) {
        continue;
      }

      const availabilityReasons = new Set([
        "INVALID_DATE",
        "BEFORE_OPENING",
        "OUT_OF_RANGE",
        "CLOSED",
        "SAME_DAY_BLOCKED",
        "CUTOFF_PASSED",
        "PHONE_ONLY",
        "PRIVATE_BLOCK",
      ]);

      if (availabilityReasons.has(message)) {
        const mapped = availabilityReasonToError(
          message as Parameters<typeof availabilityReasonToError>[0]
        );
        logError("reservation.create.failed", {
          requestId,
          route: "/api/reservations",
          errorCode: mapped.code,
          context: { attempt, message, date, servicePeriod, partySize },
        });
        return apiError(mapped.status, {
          error: mapped.error,
          code: mapped.code,
          requestId,
          ...contact,
        });
      }

      const status = isRetryable ? 409 : 500;
      const code = isRetryable ? "RESERVATION_CONFLICT" : "UNKNOWN_ERROR";
      const errorMessage = isRetryable
        ? "予約処理が競合しました。時間をおいて再度お試しください。"
        : "予約処理に失敗しました";

      logError("reservation.create.failed", {
        requestId,
        route: "/api/reservations",
        errorCode: code,
        context: { attempt, message, date, servicePeriod, partySize },
      });

      return apiError(status, {
        error: errorMessage,
        code,
        requestId,
        ...contact,
      });
    }
  }

  logError("reservation.retry.exceeded", {
    requestId,
    route: "/api/reservations",
    errorCode: "RETRY_EXCEEDED",
  });

  return apiError(500, {
    error: "予約処理が混み合っています。時間をおいてお試しください",
    code: "RETRY_EXCEEDED",
    requestId,
    ...contact,
  });
}
