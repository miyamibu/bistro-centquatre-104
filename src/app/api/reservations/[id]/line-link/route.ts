import { NextRequest, NextResponse } from "next/server";
import { Prisma, ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { getContactPayload } from "@/lib/contact";
import { getRequestId, logError, logInfo, logWarn } from "@/lib/logger";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";
import { linkLineToReservationSchema } from "@/lib/validation/reservations";
import {
  buildReservationCreatedText,
  canPushToLineUser,
  hashLineClaimToken,
  pushLineTextMessage,
  summarizeLineError,
  verifyLineClaimTokenHash,
  verifyLineIdToken,
} from "@/lib/line";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Post-booking LINE linking flow.
 *
 * POST /api/reservations/[id]/line-link
 * Body: { claimToken: string, lineIdToken: string }
 *
 * Security model:
 *   - Requires the unguessable `claimToken` originally returned only in the
 *     successful reservation creation response. Server compares SHA-256(plain)
 *     to the stored hash in constant time.
 *   - The claim token is single-purpose, scoped to this reservation, and has
 *     a short expiry (LINE_CLAIM_TOKEN_TTL_MS, currently 1h).
 *   - Never trusts client-supplied `lineUserId`. Only the verified `sub` from
 *     the LINE Login verify endpoint is stored as `Reservation.lineUserId`.
 *   - Idempotent: if `lineUserId` is already set, returns 200 without sending
 *     a second confirmation message.
 *   - Confirmation message is marked sent (lineConfirmationSentAt) BEFORE the
 *     push call to prevent double-send under retries; if push fails we log,
 *     keep the link, and let the day-before reminder cover the user.
 *   - On success the claim token is cleared so it cannot be reused.
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  const requestId = getRequestId(request);
  const contact = getContactPayload();
  const { id: reservationId } = await ctx.params;

  const securityError = enforceWriteRequestSecurity(request, {
    requestId,
    requireRequestedWith: false,
  });
  if (securityError) return securityError;

  if (typeof reservationId !== "string" || reservationId.length < 1 || reservationId.length > 64) {
    return apiError(400, {
      error: "invalid reservation id",
      code: "INVALID_RESERVATION_ID",
      requestId,
      ...contact,
    });
  }

  const body = await request.json().catch(() => null);
  const parsed = linkLineToReservationSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      requestId,
      ...contact,
    });
  }
  const { claimToken, lineIdToken } = parsed.data;

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
    logError("reservation.line-link.schema_check_failed", {
      requestId,
      route: "/api/reservations/[id]/line-link",
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

  // Read once for pre-checks. We re-read inside the transaction for the
  // authoritative state (avoids TOCTOU on claim/lineUserId).
  const initial = await prisma.reservation.findUnique({
    where: { id: reservationId },
  });
  if (!initial) {
    return apiError(404, {
      error: "予約が見つかりません",
      code: "RESERVATION_NOT_FOUND",
      requestId,
      ...contact,
    });
  }
  if (initial.status !== ReservationStatus.CONFIRMED) {
    return apiError(409, {
      error: "対象の予約は LINE 連携を受け付けない状態です",
      code: "RESERVATION_NOT_CONFIRMED",
      requestId,
      ...contact,
    });
  }
  if (initial.lineUserId) {
    // Already linked. Idempotent success — no message resend.
    logInfo("reservation.line-link.already_linked", {
      requestId,
      route: "/api/reservations/[id]/line-link",
      context: { reservationId: initial.id },
    });
    return NextResponse.json({
      ok: true,
      alreadyLinked: true,
      lineNotification: { enabled: true },
      requestId,
    });
  }
  if (!verifyLineClaimTokenHash(claimToken, initial.lineClaimTokenHash)) {
    logWarn("reservation.line-link.claim_mismatch", {
      requestId,
      route: "/api/reservations/[id]/line-link",
      context: { reservationId: initial.id },
    });
    return apiError(403, {
      error: "LINE 連携トークンが無効です",
      code: "LINE_CLAIM_TOKEN_INVALID",
      requestId,
      ...contact,
    });
  }
  if (!initial.lineClaimExpiresAt || initial.lineClaimExpiresAt.getTime() < Date.now()) {
    logWarn("reservation.line-link.claim_expired", {
      requestId,
      route: "/api/reservations/[id]/line-link",
      context: { reservationId: initial.id },
    });
    return apiError(410, {
      error: "LINE 連携の有効期限が切れています",
      code: "LINE_CLAIM_TOKEN_EXPIRED",
      requestId,
      ...contact,
    });
  }

  // Verify the LINE ID token (server-side via LINE Login verify endpoint).
  let verifiedSub: string | null = null;
  try {
    verifiedSub = await verifyLineIdToken(lineIdToken);
  } catch (lineError) {
    logError("reservation.line-link.verify_error", {
      requestId,
      route: "/api/reservations/[id]/line-link",
      errorCode: "LINE_VERIFY_UNEXPECTED",
      context: {
        message:
          lineError instanceof Error ? lineError.message : String(lineError),
      },
    });
  }
  if (!verifiedSub) {
    return apiError(400, {
      error: "LINE 認証に失敗しました",
      code: "LINE_VERIFY_FAILED",
      requestId,
      ...contact,
    });
  }

  // Confirm the bot can push to this LINE user.
  const pushable = await canPushToLineUser(verifiedSub);
  if (!pushable) {
    logInfo("reservation.line-link.not_pushable", {
      requestId,
      route: "/api/reservations/[id]/line-link",
      context: { reservationId: initial.id },
    });
    return apiError(422, {
      error: "LINE 公式アカウントに通知を送れません。友だち追加を確認してください。",
      code: "LINE_NOT_PUSHABLE",
      requestId,
      ...contact,
    });
  }

  // Atomic update. Use updateMany with the where filter so we only flip
  // lineUserId on the row that still has the matching claim hash and is
  // not yet linked. This prevents races between concurrent retries.
  let linkedRowCount = 0;
  const computedHash = hashLineClaimToken(claimToken);
  try {
    const result = await prisma.reservation.updateMany({
      where: {
        id: reservationId,
        status: ReservationStatus.CONFIRMED,
        lineUserId: null,
        lineClaimTokenHash: computedHash,
        lineClaimExpiresAt: { gt: new Date() },
      },
      data: {
        lineUserId: verifiedSub,
        // Pre-mark to prevent any concurrent retry from sending a second message.
        lineConfirmationSentAt: new Date(),
        // Consume the claim token.
        lineClaimTokenHash: null,
        lineClaimExpiresAt: null,
      },
    });
    linkedRowCount = result.count;
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "予約システムの準備が完了していません",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
        ...contact,
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      // Treat retryable Prisma errors as conflict — caller may retry.
      logWarn("reservation.line-link.update_conflict", {
        requestId,
        route: "/api/reservations/[id]/line-link",
        context: { reservationId: initial.id, prismaCode: error.code },
      });
      return apiError(409, {
        error: "更新が競合しました。少し待ってから再試行してください。",
        code: "LINE_LINK_CONFLICT",
        requestId,
        ...contact,
      });
    }
    logError("reservation.line-link.update_failed", {
      requestId,
      route: "/api/reservations/[id]/line-link",
      errorCode: "LINE_LINK_UPDATE_FAILED",
      context: {
        reservationId: initial.id,
        message: summarizeLineError(error),
      },
    });
    return apiError(500, {
      error: "LINE 連携に失敗しました",
      code: "LINE_LINK_UPDATE_FAILED",
      requestId,
      ...contact,
    });
  }

  if (linkedRowCount === 0) {
    // Another concurrent request already linked the reservation, OR the
    // claim was consumed/expired between pre-check and update. Re-read to
    // decide between idempotent success vs hard failure.
    const after = await prisma.reservation.findUnique({
      where: { id: reservationId },
    });
    if (after?.lineUserId) {
      logInfo("reservation.line-link.race_already_linked", {
        requestId,
        route: "/api/reservations/[id]/line-link",
        context: { reservationId: initial.id },
      });
      return NextResponse.json({
        ok: true,
        alreadyLinked: true,
        lineNotification: { enabled: true },
        requestId,
      });
    }
    logWarn("reservation.line-link.update_no_match", {
      requestId,
      route: "/api/reservations/[id]/line-link",
      context: { reservationId: initial.id },
    });
    return apiError(409, {
      error: "LINE 連携に失敗しました。再度予約からやり直してください。",
      code: "LINE_LINK_NOT_APPLIED",
      requestId,
      ...contact,
    });
  }

  // Re-read for the push payload (date/arrivalTime/partySize). We avoid
  // including raw name/phone/note in the message body by design.
  const linked = await prisma.reservation.findUnique({
    where: { id: reservationId },
  });
  if (!linked) {
    // Shouldn't happen, but stay safe.
    return apiError(500, {
      error: "LINE 連携に失敗しました",
      code: "LINE_LINK_POST_LOOKUP_FAILED",
      requestId,
      ...contact,
    });
  }

  // Push confirmation message. We've already pre-marked lineConfirmationSentAt
  // so any concurrent retry is a no-op. If push fails here we DO NOT roll back
  // — the link is real and the day-before reminder will still work.
  const text = buildReservationCreatedText({
    date: linked.date,
    arrivalTime: linked.arrivalTime,
    partySize: linked.partySize,
  });
  const pushResult = await pushLineTextMessage({
    to: verifiedSub,
    text,
  });

  if (!pushResult.ok) {
    logError("reservation.line-link.push_failed", {
      requestId,
      route: "/api/reservations/[id]/line-link",
      errorCode: "LINE_PUSH_FAILED",
      context: {
        reservationId: linked.id,
        error: summarizeLineError(pushResult.error ?? "unknown"),
      },
    });
    // Do not surface push failure to the user as a hard failure — the
    // reservation is linked and the day-before reminder remains in place.
    return NextResponse.json({
      ok: true,
      alreadyLinked: false,
      lineNotification: { enabled: true, confirmationSent: false },
      requestId,
    });
  }

  logInfo("reservation.line-link.success", {
    requestId,
    route: "/api/reservations/[id]/line-link",
    context: { reservationId: linked.id },
  });

  return NextResponse.json({
    ok: true,
    alreadyLinked: false,
    lineNotification: { enabled: true, confirmationSent: true },
    requestId,
  });
}
