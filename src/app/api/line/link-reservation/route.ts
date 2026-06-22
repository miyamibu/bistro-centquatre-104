/**
 * POST /api/line/link-reservation
 *
 * Two flows:
 *   Token flow  — { token, phoneLast4, lineIdToken }
 *   Lookup flow — { date, phone, nameFragment, lineIdToken }
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
  normalizeReservationPhone,
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
import { isLineReservationLookupLinkEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Single safe error surfaced to the client for all validation failures. */
const SAFE_ERROR = "予約情報を確認できませんでした。入力内容をご確認ください。";

/** Non-enumerating code for all input-level failures (phone, date, name, token). */
const LINK_VALIDATION_FAILED = "LINK_VALIDATION_FAILED";

const tokenFlowSchema = z.object({
  token: z.string().min(1).max(256),
  phoneLast4: z.string().regex(/^\d{4}$/),
  lineIdToken: z.string().min(1).max(4096),
});

const lookupFlowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phone: z.string().min(6).max(32),
  nameFragment: z.string().trim().min(2).max(40),
  lineIdToken: z.string().min(1).max(4096),
});

type LinkFlow = "token" | "lookup";

function detectFlow(body: unknown): LinkFlow | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.token === "string") return "token";
  if (typeof b.date === "string") return "lookup";
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

/**
 * Atomically link a reservation to a LINE user using a database transaction.
 *
 * The conditional updateMany (WHERE lineUserId IS NULL) is the key safety
 * mechanism: even if two concurrent requests both pass the initial validation
 * check, only one can set lineUserId on a reservation row.
 *
 * Returns:
 *   { linked: true, reservationId }  — successfully linked
 *   { linked: false, alreadyLinked } — idempotent: same user was already linked
 *   { linked: false, conflict: true } — different lineUserId already on reservation
 *   { linked: false, invalid: true }  — reservation status/type not eligible
 */
type LinkOutcome =
  | { linked: true; reservationId: string }
  | { linked: false; alreadyLinked: true }
  | { linked: false; conflict: true }
  | { linked: false; invalid: true };

async function atomicLinkReservation(
  reservationId: string,
  lineUserId: string,
  linkSource: string,
  existingLineUserId: string | null,
  phone: string,
  status: ReservationStatus,
  reservationType: ReservationType
): Promise<LinkOutcome> {
  if (
    status !== ReservationStatus.CONFIRMED ||
    reservationType !== ReservationType.NORMAL
  ) {
    return { linked: false, invalid: true };
  }

  // Idempotent: already linked to same user.
  if (existingLineUserId === lineUserId) {
    return { linked: false, alreadyLinked: true };
  }

  // Conflict: already linked to different user.
  if (existingLineUserId !== null) {
    return { linked: false, conflict: true };
  }

  // canPushToLineUser makes an HTTP call — do it OUTSIDE the DB transaction.
  const pushResult = await canPushToLineUser(lineUserId);
  if (pushResult.status !== "ACTIVE") {
    return { linked: false, invalid: true };
  }
  const now = new Date();

  // Conditional update: only applies if lineUserId is still null.
  // This is the TOCTOU guard — two concurrent requests for the same reservation
  // will both see lineUserId=null in the read, but only one updateMany succeeds.
  const updated = await prisma.reservation.updateMany({
    where: { id: reservationId, lineUserId: null },
    data: {
      lineUserId,
      lineLinkedAt: now,
      lineLinkSource: linkSource,
      linePushStatus: pushResult.status,
      linePushCheckedAt: now,
      lineReminderError: null,
    },
  });

  if (updated.count > 0) {
    logInfo("line.link.success", {
      route: "/api/line/link-reservation",
      context: { reservationId, linkSource, pushStatus: pushResult.status },
    });
    return { linked: true, reservationId };
  }

  // updateMany returned 0: another request won the race.
  const current = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { lineUserId: true },
  });
  if (current?.lineUserId === lineUserId) {
    return { linked: false, alreadyLinked: true };
  }
  return { linked: false, conflict: true };
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  const securityError = enforceWriteRequestSecurity(request, {
    requestId,
    requireRequestedWith: false,
  });
  if (securityError) return securityError;

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
    // Fail-closed: rate limit DB failure must not be treated as "allowed".
    // The lookup flow uses date/phone/name — fail-open here would be a security gap.
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
        // This guards against a concurrent lookup-flow or second-token linking
        // the same reservation between the reservation read above and now.
        const resUpdated = await tx.reservation.updateMany({
          where: { id: res.id, lineUserId: null },
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
            select: { lineUserId: true },
          });
          if (recheck?.lineUserId === lineUserId) {
            return { ok: true, reservationId: res.id, alreadyLinked: true };
          }
          return { ok: false, reason: "CONFLICT" };
        }

        return { ok: true, reservationId: res.id, alreadyLinked: false };
      });
    } catch (txErr) {
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

  // ── Lookup flow ─────────────────────────────────────────────────────────────
  if (!isLineReservationLookupLinkEnabled()) {
    return apiError(404, { error: SAFE_ERROR, code: "LINE_LOOKUP_LINK_DISABLED", requestId });
  }

  const parsed = lookupFlowSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
  }
  const { date, phone, nameFragment, lineIdToken } = parsed.data;

  const lineUserId = await verifyLineIdToken(lineIdToken);
  if (!lineUserId) {
    return apiError(401, { error: SAFE_ERROR, code: "LINE_ID_TOKEN_INVALID", requestId });
  }

  const normalizedPhone = normalizeReservationPhone(phone);
  if (normalizedPhone.length < 6) {
    return apiError(400, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
  }

  const candidates = await prisma.reservation.findMany({
    where: {
      date,
      status: ReservationStatus.CONFIRMED,
      reservationType: ReservationType.NORMAL,
    },
    select: { id: true, phone: true, name: true, lineUserId: true, status: true, reservationType: true },
  });

  const normalizedFragment = nameFragment.trim();
  const matched = candidates.filter(
    (r) =>
      normalizeReservationPhone(r.phone) === normalizedPhone &&
      r.name.includes(normalizedFragment)
  );

  if (matched.length !== 1) {
    logInfo("line.link.lookup_no_unique_match", {
      requestId,
      route: "/api/line/link-reservation",
      context: { matchCount: matched.length },
    });
    // Use same generic code — do not reveal 0 vs multiple matches.
    return apiError(400, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
  }

  const reservation = matched[0];

  const outcome = await atomicLinkReservation(
    reservation.id,
    lineUserId,
    "LINE_ACCOUNT_LOOKUP",
    reservation.lineUserId,
    reservation.phone,
    reservation.status,
    reservation.reservationType
  );

  if ("invalid" in outcome) {
    return apiError(400, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
  }
  if ("conflict" in outcome) {
    logWarn("line.link.conflict", {
      requestId,
      route: "/api/line/link-reservation",
      context: { reservationId: reservation.id },
    });
    return apiError(409, { error: SAFE_ERROR, code: LINK_VALIDATION_FAILED, requestId });
  }

  const resolvedReservationId = "reservationId" in outcome ? outcome.reservationId : reservation.id;

  const immediateReminderSent = await maybeSendImmediateReminder(
    resolvedReservationId,
    lineUserId,
    requestId
  );

  return NextResponse.json({
    ok: true,
    lineNotification: { enabled: true, immediateReminderSent },
  });
}
