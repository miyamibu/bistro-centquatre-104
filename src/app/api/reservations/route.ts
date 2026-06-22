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
import { isLinePhoneAutoAttachEnabled } from "@/lib/env";
import { getContactPayload } from "@/lib/contact";
import { env } from "@/lib/env";
import {
  canPushToLineUser,
  generateLineLinkToken,
  hashNormalizedPhone,
  hashLineLinkToken,
  normalizeReservationPhone,
  verifyLineIdToken,
  type CanPushResult,
} from "@/lib/line";
import {
  LINE_CUSTOMER_LINK_SOURCE,
  getLineCustomerLinkConsentCutoff,
} from "@/lib/line-customer-link";
import { getRequestId, logError, logInfo, logWarn } from "@/lib/logger";

export const dynamic = "force-dynamic";

const RETRIES = 3;
const LINK_TOKEN_TTL_HOURS = 48;

type ResolvedLineLink = {
  lineUserId: string;
  linkSource: string;
  canPushResult: CanPushResult;
};

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

async function createLineLinkToken(reservationId: string): Promise<string> {
  const rawToken = generateLineLinkToken();
  const tokenHash = hashLineLinkToken(rawToken);
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await prisma.reservationLineLinkToken.create({
    data: { reservationId, tokenHash, expiresAt },
  });
  return rawToken;
}

// Raw tokens are never stored — only their hash. We always generate a fresh
// token for each response; existing unused tokens expire naturally (48 h TTL).
async function getOrCreateLineLinkToken(reservationId: string): Promise<string> {
  return createLineLinkToken(reservationId);
}

async function resolveLineCustomerLinkByPhone(
  phone: string,
  requestId: string
): Promise<ResolvedLineLink | null> {
  if (!isLinePhoneAutoAttachEnabled()) {
    logInfo("reservation.line.customer_link_auto_attach_disabled", {
      requestId,
      route: "/api/reservations",
    });
    return null;
  }

  const normalizedPhone = normalizeReservationPhone(phone);
  if (normalizedPhone.length < 6) return null;

  const normalizedPhoneHash = hashNormalizedPhone(normalizedPhone);
  const now = new Date();
  const links = await prisma.lineCustomerLink.findMany({
    where: {
      normalizedPhoneHash,
      status: "ACTIVE",
      lastLinkedAt: { gte: getLineCustomerLinkConsentCutoff(now) },
    },
    select: { lineUserId: true },
    take: 3,
  });
  const lineUserIds = [...new Set(links.map((link) => link.lineUserId))];

  if (lineUserIds.length !== 1) {
    if (lineUserIds.length > 1) {
      logWarn("reservation.line.customer_link_ambiguous", {
        requestId,
        route: "/api/reservations",
        context: { matchCount: lineUserIds.length },
      });
    }
    return null;
  }

  const lineUserId = lineUserIds[0];
  const friend = await prisma.lineFriend.findUnique({
    where: { lineUserId },
    select: { friendshipStatus: true },
  });
  if (friend?.friendshipStatus === "BLOCKED") {
    logInfo("reservation.line.customer_link_blocked", {
      requestId,
      route: "/api/reservations",
    });
    return null;
  }

  const canPushResult = await canPushToLineUser(lineUserId);
  if (canPushResult.status !== "ACTIVE") {
    logInfo("reservation.line.customer_link_push_not_active", {
      requestId,
      route: "/api/reservations",
      context: { pushStatus: canPushResult.status },
    });
    return null;
  }

  logInfo("reservation.line.customer_link_resolved", {
    requestId,
    route: "/api/reservations",
    context: { pushStatus: canPushResult.status },
  });

  return {
    lineUserId,
    linkSource: LINE_CUSTOMER_LINK_SOURCE,
    canPushResult,
  };
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const contact = getContactPayload();
  const securityError = enforceWriteRequestSecurity(request, {
    requestId,
    requireRequestedWith: false,
  });
  if (securityError) return securityError;

  const body = await request.json().catch(() => null);

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
    await enforceReservationWriteRateLimit(prisma, { ipHash });
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

  // Verify LIFF ID token server-side. Never trust client-supplied lineUserId.
  let resolvedLineUserId: string | null = null;
  let resolvedLineLinkSource: string | null = null;
  let canPushResult: CanPushResult | null = null;

  if (typeof lineIdToken === "string" && lineIdToken.length > 0) {
    try {
      const sub = await verifyLineIdToken(lineIdToken);
      if (sub) {
        const verifiedPushResult = await canPushToLineUser(sub);
        if (verifiedPushResult.status === "ACTIVE") {
          canPushResult = verifiedPushResult;
          resolvedLineUserId = sub;
          resolvedLineLinkSource = "RESERVATION_FORM";
        }
        logInfo("reservation.line.verified", {
          requestId,
          route: "/api/reservations",
          context: { pushStatus: verifiedPushResult.status },
        });
      } else {
        logInfo("reservation.line.verify_failed", {
          requestId,
          route: "/api/reservations",
        });
      }
    } catch (lineError) {
      // LINE failure must never fail reservation creation.
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

  if (!resolvedLineUserId) {
    try {
      const linkedCustomer = await resolveLineCustomerLinkByPhone(phone, requestId);
      if (linkedCustomer) {
        resolvedLineUserId = linkedCustomer.lineUserId;
        resolvedLineLinkSource = linkedCustomer.linkSource;
        canPushResult = linkedCustomer.canPushResult;
      }
    } catch (lineError) {
      // LINE customer-link failures must never fail reservation creation.
      logError("reservation.line.customer_link_unexpected_error", {
        requestId,
        route: "/api/reservations",
        errorCode: "LINE_CUSTOMER_LINK_UNEXPECTED",
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

  const linePushStatus = canPushResult?.status ?? null;
  const linePushCheckedAt = canPushResult ? new Date() : null;

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
            if (resolvedLineUserId) {
              if (duplicateReservation.lineUserId === resolvedLineUserId) {
                // Same user — idempotent.
                return {
                  reservation: duplicateReservation,
                  deduplicated: true,
                  lineLinked: true,
                  lineEnabled: true,
                };
              }
              // Never attach a LINE user to an existing duplicate reservation.
              return {
                reservation: duplicateReservation,
                deduplicated: true,
                lineLinked: false,
                lineEnabled: !!duplicateReservation.lineUserId,
              };
            }
            return {
              reservation: duplicateReservation,
              deduplicated: true,
              lineLinked: null,
              lineEnabled: !!duplicateReservation.lineUserId,
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
            lineUserId: resolvedLineUserId,
            lineLinkedAt: resolvedLineUserId ? now : null,
            lineLinkSource: resolvedLineUserId ? resolvedLineLinkSource : null,
            linePushStatus,
            linePushCheckedAt,
          });

          return {
            reservation: createdReservation,
            deduplicated: false,
            lineLinked: resolvedLineUserId ? true : null,
            lineEnabled: !!resolvedLineUserId,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      const { reservation, deduplicated, lineLinked, lineEnabled } = result;

      // Warn if duplicate with conflicting LINE user (no PII in log).
      if (deduplicated && lineLinked === false && resolvedLineUserId) {
        logWarn("reservation.line.duplicate_conflict", {
          requestId,
          route: "/api/reservations",
          context: { reservationId: reservation.id },
        });
      }

      const adminLink = env.BASE_URL
        ? `${env.BASE_URL}/admin/reservations/${reservation.id}`
        : "";

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
          lineLinked,
        },
      });

      // Build lineNotification response.
      let lineNotification: Record<string, unknown>;
      if (lineEnabled) {
        lineNotification = { enabled: true };
        if (lineLinked !== null) lineNotification.lineLinked = lineLinked;
        if (deduplicated) lineNotification.deduplicated = true;
      } else if (deduplicated) {
        lineNotification = { enabled: false, deduplicated: true };
      } else {
        // Generate a post-reservation link URL using the LIFF link endpoint.
        let linkUrl: string | undefined;
        try {
          const rawToken = await getOrCreateLineLinkToken(reservation.id);
          const liffLinkId =
            process.env.NEXT_PUBLIC_LIFF_LINK_ID ?? process.env.NEXT_PUBLIC_LIFF_ID;
          if (liffLinkId) {
            linkUrl = `https://liff.line.me/${liffLinkId}?t=${encodeURIComponent(rawToken)}`;
          } else {
            linkUrl = `/line/link?t=${encodeURIComponent(rawToken)}`;
          }
        } catch (tokenError) {
          logError("reservation.line_token.failed", {
            requestId,
            route: "/api/reservations",
            errorCode: "LINE_TOKEN_CREATE_FAILED",
            context: {
              reservationId: reservation.id,
              message: tokenError instanceof Error ? tokenError.message : String(tokenError),
            },
          });
        }
        lineNotification = { enabled: false, ...(linkUrl ? { linkUrl } : {}) };
      }

      // adminLink is intentionally omitted from the public response.
      // Admin navigation is handled via admin API / admin UI only.
      return NextResponse.json({
        reservationId: reservation.id,
        summary: `${reservation.date} ${reservation.servicePeriod === "LUNCH" ? "ランチ" : "ディナー"} ${reservation.partySize}名で承りました。`,
        deduplicated,
        lineNotification,
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
