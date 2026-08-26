import { NextRequest, NextResponse } from "next/server";
import { Prisma, ReservationStatus, ReservationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  availabilityReasonToError,
  isArrivalTimeValid,
  isCoursePeriodConsistent,
} from "@/lib/availability";
import {
  enforceReservationWriteRateLimit,
  isReservationRateLimitError,
} from "@/lib/reservation-rate-limit";
import { acquireReservationAdvisoryLock } from "@/lib/reservation-advisory-lock";
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
import {
  apiError,
  DEFAULT_JSON_BODY_LIMIT_BYTES,
  readLimitedJson,
} from "@/lib/api-security";
import {
  buildReservationRequestHash,
  claimReservationIdempotency,
  findReservationIdempotency,
  finalizeReservationIdempotency,
  isValidReservationIdempotencyKey,
  ReservationIdempotencyConflictError,
  ReservationIdempotencyInProgressError,
} from "@/lib/reservation-idempotency";
import { getContactPayload } from "@/lib/contact";
import {
  canPushToLineUser,
  hashLineLinkToken,
  verifyLineIdToken,
  type CanPushResult,
} from "@/lib/line";
import { getRequestId, logError, logInfo, logWarn } from "@/lib/logger";
import {
  enqueueReservationConfirmationEmail,
  enqueueReservationCustomerEmail,
  getReservationEmailOutboxBacklog,
  processReservationEmailOutboxEntries,
} from "@/lib/reservation-email-outbox";
import { recordImmediateAttempt } from "@/lib/scheduler-heartbeat";
import { scheduleAfterResponse } from "@/lib/after-response";
import {
  buildReservationManagementUrl,
  issueReservationManagementToken,
} from "@/lib/reservation-management-token";
import {
  deriveReservationScopedToken,
  getActiveReservationTokenKeyId,
} from "@/lib/reservation-token";
import { SELF_SERVICE_CANCELLATION_POLICY_VERSION } from "@/lib/cancellation-policy";

export const dynamic = "force-dynamic";

const RETRIES = 3;
const LINK_TOKEN_TTL_HOURS = 48;

function getReservationManagementBaseUrl(request: NextRequest) {
  return process.env.BASE_URL?.trim() || request.nextUrl.origin;
}

type ReservationLineNotification = {
  enabled: boolean;
  lineLinked?: boolean;
  deduplicated?: boolean;
  linkUrl?: string;
};

type ReservationResponseBody = {
  reservationId: string;
  summary: string;
  managementUrl?: string;
  deduplicated: boolean;
  lineNotification: ReservationLineNotification;
  requestId: string;
};

type PersistedReservationResponseBody = Omit<
  ReservationResponseBody,
  "managementUrl"
> & {
  lineNotification: Omit<ReservationLineNotification, "linkUrl">;
  lineLinkIssued: boolean;
  // Semantic duplicates are not proof of ownership of the existing reservation.
  // Keep this persisted flag so a later same-key replay remains safe.
  managementTokenIssued?: boolean;
  tokenKeyId: string;
};

async function createLineLinkToken(
  client: Prisma.TransactionClient,
  reservationId: string,
  idempotencyKey: string,
  now: Date,
): Promise<{ rawToken: string; keyId: string }> {
  const rawToken = deriveReservationScopedToken(
    "line-link",
    reservationId,
    idempotencyKey,
  );
  const tokenHash = hashLineLinkToken(rawToken);
  const keyId = getActiveReservationTokenKeyId();
  const expiresAt = new Date(now.getTime() + LINK_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await client.reservationLineLinkToken.create({
    data: { reservationId, tokenHash, keyId, expiresAt },
  });
  return { rawToken, keyId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildLineLinkUrl(rawToken: string) {
  const liffLinkId = process.env.NEXT_PUBLIC_LIFF_LINK_ID ?? process.env.NEXT_PUBLIC_LIFF_ID;
  return liffLinkId
    ? `https://liff.line.me/${liffLinkId}?t=${encodeURIComponent(rawToken)}`
    : `/line/link?t=${encodeURIComponent(rawToken)}`;
}

function restoreReservationResponseBody(
  value: Prisma.JsonValue,
  idempotencyKey: string,
  request: NextRequest,
): ReservationResponseBody {
  if (
    !isRecord(value) ||
    typeof value.reservationId !== "string" ||
    typeof value.summary !== "string" ||
    typeof value.deduplicated !== "boolean" ||
    typeof value.requestId !== "string" ||
    typeof value.lineLinkIssued !== "boolean" ||
    !isRecord(value.lineNotification) ||
    typeof value.lineNotification.enabled !== "boolean"
  ) {
    throw new Error("RESERVATION_IDEMPOTENCY_RESPONSE_INVALID");
  }

  const reservationId = value.reservationId;
  const tokenKeyId = typeof value.tokenKeyId === "string" ? value.tokenKeyId : "v1";
  const lineNotification: ReservationLineNotification = {
    enabled: value.lineNotification.enabled,
    ...(typeof value.lineNotification.lineLinked === "boolean"
      ? { lineLinked: value.lineNotification.lineLinked }
      : {}),
    ...(typeof value.lineNotification.deduplicated === "boolean"
      ? { deduplicated: value.lineNotification.deduplicated }
      : {}),
  };

  if (value.lineLinkIssued) {
    lineNotification.linkUrl = buildLineLinkUrl(
      deriveReservationScopedToken("line-link", reservationId, idempotencyKey, tokenKeyId),
    );
  }

  return {
    reservationId,
    summary: value.summary,
    ...(value.managementTokenIssued !== false
      ? {
          managementUrl: buildReservationManagementUrl(
            getReservationManagementBaseUrl(request),
            deriveReservationScopedToken("management", reservationId, idempotencyKey, tokenKeyId),
          ),
        }
      : {}),
    deduplicated: value.deduplicated,
    lineNotification,
    requestId: value.requestId,
  };
}

function getReservationIdempotencyKey(request: NextRequest) {
  return request.headers.get("idempotency-key")?.trim() ?? "";
}

function idempotencyErrorResponse(
  error: ReservationIdempotencyConflictError | ReservationIdempotencyInProgressError,
  requestId: string,
  contact: ReturnType<typeof getContactPayload>
) {
  return apiError(error.status, {
    error: error.message,
    code: error.code,
    requestId,
    ...contact,
  });
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const contact = getContactPayload();
  const bodyResult = await readLimitedJson<Record<string, unknown>>(request, {
    requestId,
    maxBytes: DEFAULT_JSON_BODY_LIMIT_BYTES,
  });
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.body;

  if (body?.reservationType === ReservationType.PRIVATE_BLOCK) {
    return apiError(403, {
      error: "貸切設定は公開予約フォームからは行えません",
      code: "PRIVATE_BLOCK_PUBLIC_DISABLED",
      requestId,
      ...contact,
    });
  }

  const idempotencyKey = getReservationIdempotencyKey(request);
  if (!isValidReservationIdempotencyKey(idempotencyKey)) {
    return apiError(400, {
      error: idempotencyKey
        ? "Idempotency-Key は255文字以内で指定してください"
        : "Idempotency-Key が必要です",
      code: idempotencyKey ? "INVALID_IDEMPOTENCY_KEY" : "MISSING_IDEMPOTENCY_KEY",
      requestId,
      ...contact,
    });
  }

  const requestHash = buildReservationRequestHash(body);

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

  try {
    const existingIdempotency = await findReservationIdempotency(prisma, idempotencyKey);
    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return idempotencyErrorResponse(
          new ReservationIdempotencyConflictError(),
          requestId,
          contact
        );
      }
      if (
        existingIdempotency.responseStatus !== null &&
        existingIdempotency.responseBody !== null
      ) {
        return NextResponse.json(
          restoreReservationResponseBody(
            existingIdempotency.responseBody,
            idempotencyKey,
            request,
          ),
          { status: existingIdempotency.responseStatus },
        );
      }
      return idempotencyErrorResponse(
        new ReservationIdempotencyInProgressError(),
        requestId,
        contact
      );
    }
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "予約システムの準備が完了していません",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
        ...contact,
      });
    }

    logError("reservation.idempotency.lookup_failed", {
      requestId,
      route: "/api/reservations",
      errorCode: "IDEMPOTENCY_LOOKUP_FAILED",
      context: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return apiError(500, {
      error: "予約処理の初期化に失敗しました",
      code: "IDEMPOTENCY_LOOKUP_FAILED",
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

  const ipAddress = getClientIp(request);
  const ipHash = hashClientIp(ipAddress);

  const {
    date,
    servicePeriod,
    partySize,
    arrivalTime,
    name,
    phone,
    customerEmail,
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

  const normalizedCustomerEmail = customerEmail?.trim().toLowerCase() || null;
  if (!normalizedCustomerEmail && !resolvedLineUserId) {
    return apiError(400, {
      error: "管理リンクを受け取るメールアドレスまたは本人確認済みLINE連携が必要です",
      code: "CUSTOMER_CONTACT_REQUIRED",
      fields: { customerEmail: "メールアドレスまたはLINE連携が必要です" },
      requestId,
      ...contact,
    });
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

  const linePushStatus = canPushResult?.status ?? null;
  const linePushCheckedAt = canPushResult ? new Date() : null;

  try {
    // Keep rate-limit accounting in its own committed transaction. Expected
    // reservation rejection or serialization rollback must not erase the event.
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
    return apiError(503, {
      error: "予約の受付状態を確認できませんでした。時間をおいて再度お試しください",
      code: "RATE_LIMIT_CHECK_FAILED",
      requestId,
      ...contact,
    });
  }

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const now = new Date();
      const result = await prisma.$transaction(
        async (tx) => {
          const claim = await claimReservationIdempotency(tx, {
            idempotencyKey,
            requestHash,
          });
          if (claim.kind === "replay") {
            return claim;
          }

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

          let reservation = duplicateReservation;
          let deduplicated = false;
          let lineLinked: boolean | null = null;
          let lineEnabled = false;
          const immediateOutboxIds: string[] = [];

          if (duplicateReservation) {
            deduplicated = true;
            if (resolvedLineUserId) {
              if (duplicateReservation.lineUserId === resolvedLineUserId) {
                // Same user — idempotent.
                lineLinked = true;
                lineEnabled = true;
              } else {
                // Never attach a LINE user to an existing duplicate reservation.
                lineLinked = false;
                lineEnabled = !!duplicateReservation.lineUserId;
              }
            } else {
              lineEnabled = !!duplicateReservation.lineUserId;
            }
          } else {
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
              customerEmail: normalizedCustomerEmail,
              contactChannel: normalizedCustomerEmail ? "EMAIL" : "LINE",
              cancellationPolicyVersion: SELF_SERVICE_CANCELLATION_POLICY_VERSION,
              cancellationPolicyAcceptedAt: now,
              note: reservationNote,
              status: ReservationStatus.CONFIRMED,
              lineUserId: resolvedLineUserId,
              lineLinkedAt: resolvedLineUserId ? now : null,
              lineLinkSource: resolvedLineUserId ? resolvedLineLinkSource : null,
              linePushStatus,
              linePushCheckedAt,
            });

            const adminOutbox = await enqueueReservationConfirmationEmail(tx, createdReservation.id);
            const customerOutbox = await enqueueReservationCustomerEmail(tx, createdReservation.id);
            immediateOutboxIds.push(adminOutbox.id, customerOutbox.id);
            reservation = createdReservation;
            lineLinked = resolvedLineUserId ? true : null;
            lineEnabled = !!resolvedLineUserId;
          }

          if (!reservation) {
            throw new Error("RESERVATION_NOT_CREATED");
          }

          // A semantic duplicate can be submitted by someone who knows matching
          // reservation details, but not the customer's existing bearer token.
          // Only mint a management token for a newly created reservation.
          const managementToken = deduplicated
            ? null
            : await issueReservationManagementToken(
                tx,
                reservation.id,
                idempotencyKey,
                now,
              );

          let lineNotification: Omit<ReservationLineNotification, "linkUrl">;
          let lineLinkIssued = false;
          let lineTokenKeyId = managementToken?.keyId ?? getActiveReservationTokenKeyId();
          if (lineEnabled) {
            lineNotification = { enabled: true };
            if (lineLinked !== null) lineNotification.lineLinked = lineLinked;
            if (deduplicated) lineNotification.deduplicated = true;
          } else if (deduplicated) {
            lineNotification = { enabled: false, deduplicated: true };
          } else {
            try {
              const lineToken = await createLineLinkToken(tx, reservation.id, idempotencyKey, now);
              lineTokenKeyId = lineToken.keyId;
              lineLinkIssued = true;
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
            lineNotification = { enabled: false };
          }

          const persistedResponseBody: PersistedReservationResponseBody = {
            reservationId: reservation.id,
            summary: `${reservation.date} ${reservation.servicePeriod === "LUNCH" ? "ランチ" : "ディナー"} ${reservation.partySize}名で承りました。`,
            deduplicated,
            lineNotification,
            lineLinkIssued,
            managementTokenIssued: !deduplicated,
            tokenKeyId: lineTokenKeyId,
            requestId,
          };
          const responseBody = restoreReservationResponseBody(
            persistedResponseBody as Prisma.JsonValue,
            idempotencyKey,
            request,
          );
          await finalizeReservationIdempotency(tx, {
            id: claim.id,
            responseStatus: 200,
            responseBody: persistedResponseBody as Prisma.InputJsonValue,
            reservationId: reservation.id,
            tokenKeyId: lineTokenKeyId,
          });

          return {
            kind: "completed" as const,
            responseBody,
            reservation,
            deduplicated,
            lineLinked,
            immediateOutboxIds,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      if (result.kind === "replay") {
        logInfo("reservation.idempotency.replayed", {
          requestId,
          route: "/api/reservations",
          context: { reservationId: result.reservationId },
        });
        return NextResponse.json(
          restoreReservationResponseBody(
            result.responseBody,
            idempotencyKey,
            request,
          ),
          { status: result.responseStatus },
        );
      }

      const { reservation, deduplicated, lineLinked, responseBody, immediateOutboxIds } = result;

      if (immediateOutboxIds.length > 0) {
        scheduleAfterResponse(async () => {
          try {
            const immediate = await processReservationEmailOutboxEntries({
              ids: immediateOutboxIds,
              requestId: `${requestId}:immediate`,
              deadlineMs: 8_000,
            });
            const backlog = await getReservationEmailOutboxBacklog();
            const success =
              immediate.failed === 0 &&
              immediate.deadLetter === 0 &&
              immediate.unsafe === 0 &&
              !immediate.deadlineReached;
            await recordImmediateAttempt("RESERVATION_EMAIL", success, {
              processed: immediate.scanned,
              retry: immediate.failed,
              deadLetter: immediate.deadLetter,
              backlog: backlog.backlog,
              oldestBacklogAt: backlog.oldestBacklogAt,
            });
          } catch (error) {
            logError("reservation.immediate_outbox.failed", {
              requestId,
              route: "/api/reservations",
              errorCode: "IMMEDIATE_OUTBOX_FAILED",
              context: {
                reservationId: reservation.id,
                message: error instanceof Error ? error.message : String(error),
              },
            });
            await getReservationEmailOutboxBacklog()
              .then((backlog) =>
                recordImmediateAttempt("RESERVATION_EMAIL", false, {
                  processed: 0,
                  retry: 1,
                  deadLetter: 0,
                  backlog: backlog.backlog,
                  oldestBacklogAt: backlog.oldestBacklogAt,
                }),
              )
              .catch(() => undefined);
          }
        });
      }

      // Warn if duplicate with conflicting LINE user (no PII in log).
      if (deduplicated && lineLinked === false && resolvedLineUserId) {
        logWarn("reservation.line.duplicate_conflict", {
          requestId,
          route: "/api/reservations",
          context: { reservationId: reservation.id },
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

      // adminLink is intentionally omitted from the public response.
      // Admin navigation is handled via admin API / admin UI only.
      return NextResponse.json(responseBody);
    } catch (error: unknown) {
      if (
        error instanceof ReservationIdempotencyConflictError ||
        error instanceof ReservationIdempotencyInProgressError
      ) {
        return idempotencyErrorResponse(error, requestId, contact);
      }

      if (isReservationSchemaNotReadyError(error)) {
        return apiError(503, {
          error: "予約システムの準備が完了していません",
          code: RESERVATION_SCHEMA_NOT_READY_CODE,
          requestId,
          ...contact,
        });
      }

      if (isReservationRateLimitError(error)) {
        return apiError(429, {
          error: error.message,
          code: error.code,
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
