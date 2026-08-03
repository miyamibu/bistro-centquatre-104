/**
 * POST /api/line/link-reservation
 *
 * Supported flow:
 *   Token flow — { token, phoneLast4, lineIdToken }
 *
 * Security guarantees
 * -------------------
 * - lineUserId is never trusted from the client; only verified from lineIdToken.
 * - Existing Reservation.lineUserId is never overwritten by a different user.
 * - Token linking uses a DB transaction with conditional updateMany
 *   (WHERE lineUserId IS NULL) to prevent TOCTOU race conditions.
 * - Error responses use a single safe message and a non-enumerating code so
 *   callers cannot distinguish wrong phone / wrong token / wrong name.
 * - Tokens, ID tokens, phone numbers, and LINE userIds are never logged.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, ReservationStatus, ReservationType } from "@prisma/client";
import { addDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { getClientIp, hashClientIp } from "@/lib/request-meta";
import { getRequestId, logError, logInfo, logWarn } from "@/lib/logger";
import {
  canPushToLineUser,
  hashLineLinkToken,
  getPhoneLast4,
  verifyLineIdToken,
} from "@/lib/line";
import { claimAndSendLineReminder, shouldSendImmediateDayBeforeReminder } from "@/lib/line-notification";
import {
  ensureLineLinkSchemaReady,
  isReservationSchemaNotReadyError,
  RESERVATION_SCHEMA_NOT_READY_CODE,
} from "@/lib/reservation-compat";
import { formatJst, todayJst } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Single safe error surfaced to the client for all validation failures. */
const SAFE_ERROR = "予約情報を確認できませんでした。入力内容をご確認ください。";

/** Non-enumerating code for all input-level failures (phone, date, name, token). */
const LINK_VALIDATION_FAILED = "LINK_VALIDATION_FAILED";
const LOOKUP_REQUIRES_TOKEN = "LINE_LOOKUP_LINK_REQUIRES_RESERVATION_TOKEN";
const LOOKUP_REQUIRES_TOKEN_MESSAGE =
  "予約日・電話番号・お名前だけの連携は利用できません。予約発行tokenを含むリンクから設定してください。";

const tokenFlowSchema = z.object({
  token: z.string().min(1).max(256),
  phoneLast4: z.string().regex(/^\d{4}$/),
  lineIdToken: z.string().min(1).max(4096),
});

type LinkFlow = "token" | "legacy-lookup";

function detectFlow(body: unknown): LinkFlow | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.token === "string") return "token";
  if (typeof b.date === "string") return "legacy-lookup";
  return null;
}

async function enforceRateLimit(ipHash: string, flow: LinkFlow): Promise<boolean> {
  const scope = `line-link-${flow}`;
  const windowMs = 15 * 60 * 1000;
  const limit = 10;
  const windowStart = new Date(Date.now() - windowMs);

  const count = await prisma.reservationRateLimitEvent.count({
    where: { keyHash: ipHash, scope, createdAt: { gte: windowStart } },
  });
  if (count >= limit) return false;

  await prisma.reservationRateLimitEvent.create({
    data: { keyHash: ipHash, scope },
  });
  return true;
}

async function maybeSendImmediateReminder(
  reservationId: string,
  lineUserId: string,
  requestId: string
): Promise<boolean> {
  // Only send immediately if JST time is >= 12:00, matching the cron window.
  if (!shouldSendImmediateDayBeforeReminder(new Date())) return false;

  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { date: true, lineReminderSentAt: true },
  });
  if (!reservation || reservation.lineReminderSentAt) return false;

  const tomorrowStr = formatJst(addDays(todayJst(), 1));
  if (reservation.date !== tomorrowStr) return false;

  const outcome = await claimAndSendLineReminder(
    reservationId,
    lineUserId,
    tomorrowStr,
    "POST_LINK_IMMEDIATE"
  );

  if (outcome === "sent") {
    logInfo("line.link.immediate_reminder_sent", {
      requestId,
      route: "/api/line/link-reservation",
      context: { reservationId },
    });
    return true;
  }
  if (outcome === "failed") {
    logError("line.link.immediate_reminder_failed", {
      requestId,
      route: "/api/line/link-reservation",
      errorCode: "IMMEDIATE_REMINDER_FAILED",
      context: { reservationId },
    });
  }
  return false;
}

class ReservationLinkConflictError extends Error {
  constructor() {
    super("reservation link conflict");
    this.name = "ReservationLinkConflictError";
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  const securityError = enforceWriteRequestSecurity(request, {
    requestId,
    requireRequestedWith: false,
  });
  if (securityError) return securityError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, { error: "リクエスト形式が不正です", code: "INVALID_JSON", requestId });
  }

  const flow = detectFlow(body);
  if (!flow) {
    return apiError(400, { error: "リクエスト形式が不正です", code: "INVALID_FLOW", requestId });
  }
  if (flow === "legacy-lookup") {
    // Do not verify the token or query reservations for the legacy search
    // payload. A date/phone/name match is not ownership proof.
    return apiError(410, {
      error: LOOKUP_REQUIRES_TOKEN_MESSAGE,
      code: LOOKUP_REQUIRES_TOKEN,
      requestId,
    });
  }

  const ipAddress = getClientIp(request);
  const ipHash = hashClientIp(ipAddress);

  // Guard: fail safely if migration has not been applied.
  try {
    await ensureLineLinkSchemaReady(prisma);
  } catch (schemaError) {
    if (isReservationSchemaNotReadyError(schemaError)) {
      return apiError(503, {
        error: "サービスの準備が完了していません",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }
    logError("line.link.schema_check_failed", {
      requestId,
      route: "/api/line/link-reservation",
      errorCode: "SCHEMA_CHECK_FAILED",
      context: { message: schemaError instanceof Error ? schemaError.message : String(schemaError) },
    });
    return apiError(500, { error: SAFE_ERROR, code: "LINK_FAILED", requestId });
  }

  try {
    const allowed = await enforceRateLimit(ipHash, flow);
    if (!allowed) {
      return apiError(429, {
        error: "しばらく時間をおいて再度お試しください",
        code: "RATE_LIMIT",
        requestId,
      });
    }
  } catch (rateLimitError) {
    logError("line.link.rate_limit_failed", {
      requestId,
      route: "/api/line/link-reservation",
      errorCode: "RATE_LIMIT_CHECK_FAILED",
      context: {
        message: rateLimitError instanceof Error ? rateLimitError.message : String(rateLimitError),
      },
    });
    // Fail-closed: a rate-limit database failure must not be treated as allowed.
    return apiError(503, {
      error: "一時的なエラーが発生しました。しばらく経ってから再度お試しください。",
      code: "RATE_LIMIT_CHECK_FAILED",
      requestId,
    });
  }

  // ── Token flow ──────────────────────────────────────────────────────────────
  if (flow === "token") {
    const parsed = tokenFlowSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
    }
    const { token, phoneLast4, lineIdToken } = parsed.data;

    const lineUserId = await verifyLineIdToken(lineIdToken);
    if (!lineUserId) {
      return apiError(401, { error: SAFE_ERROR, code: "LINE_ID_TOKEN_INVALID", requestId });
    }
    const pushResult = await canPushToLineUser(lineUserId);
    if (pushResult.status !== "ACTIVE") {
      logWarn("line.link.push_status_not_active", {
        requestId,
        route: "/api/line/link-reservation",
        context: { pushStatus: pushResult.status },
      });
      return apiError(409, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
    }

    const tokenHash = (() => {
      try {
        return hashLineLinkToken(token);
      } catch {
        return null;
      }
    })();
    if (!tokenHash) {
      return apiError(500, { error: SAFE_ERROR, code: "LINK_FAILED", requestId });
    }

    // All token validation + reservation update happens inside a transaction.
    // The transaction ensures token.usedAt and reservation.lineUserId are
    // set atomically: two concurrent requests cannot both succeed.
    type TxResult =
      | { ok: true; reservationId: string; alreadyLinked: false }
      | { ok: true; reservationId: string; alreadyLinked: true }
      | { ok: false; reason: "INVALID" | "PHONE_MISMATCH" | "CONFLICT" | "EXPIRED" | "USED" };

    let txResult: TxResult;
    try {
      txResult = await prisma.$transaction(async (tx): Promise<TxResult> => {
        const linkToken = await tx.reservationLineLinkToken.findUnique({
          where: { tokenHash },
          include: {
            reservation: {
              select: {
                id: true,
                phone: true,
                status: true,
                reservationType: true,
                lineUserId: true,
              },
            },
          },
        });

        if (!linkToken || linkToken.expiresAt < new Date()) {
          return { ok: false, reason: "EXPIRED" };
        }

        const res = linkToken.reservation;

        if (
          res.status !== ReservationStatus.CONFIRMED ||
          res.reservationType !== ReservationType.NORMAL
        ) {
          return { ok: false, reason: "INVALID" };
        }

        // Idempotent: same user already linked via a previous call.
        if (linkToken.usedAt && res.lineUserId === lineUserId) {
          return { ok: true, reservationId: res.id, alreadyLinked: true };
        }
        if (linkToken.usedAt) {
          return { ok: false, reason: "USED" };
        }

        // Validate phone before consuming the token.
        if (getPhoneLast4(res.phone) !== phoneLast4) {
          // Do NOT mark token as used — wrong caller, preserve for legitimate use.
          return { ok: false, reason: "PHONE_MISMATCH" };
        }

        // Atomically consume the token (WHERE usedAt IS NULL).
        // If two concurrent requests reach here, only one updateMany succeeds.
        const tokenUsed = await tx.reservationLineLinkToken.updateMany({
          where: { id: linkToken.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (tokenUsed.count === 0) {
          // Concurrent request consumed the token while we were working.
          const recheck = await tx.reservation.findUnique({
            where: { id: res.id },
            select: { lineUserId: true },
          });
          if (recheck?.lineUserId === lineUserId) {
            return { ok: true, reservationId: res.id, alreadyLinked: true };
          }
          return { ok: false, reason: "USED" };
        }

        // Conflict: different lineUserId already set.
        if (res.lineUserId !== null && res.lineUserId !== lineUserId) {
          return { ok: false, reason: "CONFLICT" };
        }
        // Idempotent inside the same token use.
        if (res.lineUserId === lineUserId) {
          return { ok: true, reservationId: res.id, alreadyLinked: true };
        }

        // Conditionally set lineUserId (WHERE lineUserId IS NULL).
        // Keep status/type in the CAS predicate so a concurrent cancellation or
        // private-block transition cannot be linked after the initial read.
        const resUpdated = await tx.reservation.updateMany({
          where: {
            id: res.id,
            lineUserId: null,
            status: ReservationStatus.CONFIRMED,
            reservationType: ReservationType.NORMAL,
          },
          data: {
            lineUserId,
            lineLinkedAt: new Date(),
            lineLinkSource: "POST_RESERVATION_LINK",
            // linePushStatus set after transaction to avoid HTTP call inside TX.
            lineReminderError: null,
          },
        });

        if (resUpdated.count === 0) {
          const recheck = await tx.reservation.findUnique({
            where: { id: res.id },
            select: { lineUserId: true, status: true, reservationType: true },
          });
          if (
            recheck?.lineUserId === lineUserId &&
            recheck.status === ReservationStatus.CONFIRMED &&
            recheck.reservationType === ReservationType.NORMAL
          ) {
            return { ok: true, reservationId: res.id, alreadyLinked: true };
          }
          // Roll back token consumption as well as the link attempt. A
          // cancellation/type transition winning this race must not leave a
          // token irreversibly consumed without a successful link.
          throw new ReservationLinkConflictError();
        }

        return { ok: true, reservationId: res.id, alreadyLinked: false };
      });
    } catch (txErr) {
      if (txErr instanceof ReservationLinkConflictError) {
        return apiError(409, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
      }
      if (
        txErr instanceof Prisma.PrismaClientKnownRequestError &&
        txErr.code === "P2034"
      ) {
        return apiError(409, { error: SAFE_ERROR, code: "LINK_FAILED", requestId });
      }
      logError("line.link.transaction_failed", {
        requestId,
        route: "/api/line/link-reservation",
        errorCode: "TX_FAILED",
        context: { message: txErr instanceof Error ? txErr.message : String(txErr) },
      });
      return apiError(500, { error: SAFE_ERROR, code: "LINK_FAILED", requestId });
    }

    if (!txResult.ok) {
      if (txResult.reason === "PHONE_MISMATCH") {
        logWarn("line.link.phone_mismatch", {
          requestId,
          route: "/api/line/link-reservation",
        });
        // Use same error/code as other validation failures — do not reveal which field.
        return apiError(400, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
      }
      if (txResult.reason === "CONFLICT") {
        logWarn("line.link.conflict", {
          requestId,
          route: "/api/line/link-reservation",
        });
        return apiError(409, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
      }
      return apiError(400, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
    }

    // Update linePushStatus outside the transaction (HTTP call to LINE API).
    if (!txResult.alreadyLinked) {
      await prisma.reservation
        .update({
          where: { id: txResult.reservationId },
          data: { linePushStatus: pushResult.status, linePushCheckedAt: new Date() },
        })
        .catch((e) =>
          logError("line.link.push_status_update_failed", {
            requestId,
            route: "/api/line/link-reservation",
            errorCode: "PUSH_STATUS_UPDATE_FAILED",
            context: { message: e instanceof Error ? e.message : String(e) },
          })
        );
    }

    const immediateReminderSent = await maybeSendImmediateReminder(
      txResult.reservationId,
      lineUserId,
      requestId
    );

    return NextResponse.json({
      ok: true,
      lineNotification: { enabled: true, immediateReminderSent },
    });
  }

  return apiError(410, {
    error: LOOKUP_REQUIRES_TOKEN_MESSAGE,
    code: LOOKUP_REQUIRES_TOKEN,
    requestId,
  });
}
