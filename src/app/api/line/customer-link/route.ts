/**
 * POST /api/line/customer-link
 *
 * Registers explicit consent to use a verified LINE userId for future normal
 * reservations matching the submitted phone number.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { getClientIp, hashClientIp } from "@/lib/request-meta";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureLineLinkSchemaReady,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";
import {
  canPushToLineUser,
  hashNormalizedPhone,
  normalizeReservationPhone,
  verifyLineIdToken,
} from "@/lib/line";
import { getRequestId, logError, logInfo } from "@/lib/logger";
import { isLinePhoneAutoAttachEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  phone: z.string().trim().min(6).max(32),
  lineIdToken: z.string().min(1).max(4096),
});

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

async function enforceCustomerLinkRateLimit(ipHash: string) {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const scope = "line-customer-link";
  const count = await prisma.reservationRateLimitEvent.count({
    where: { keyHash: ipHash, scope, createdAt: { gte: windowStart } },
  });
  if (count >= RATE_LIMIT_MAX) return false;
  await prisma.reservationRateLimitEvent.create({ data: { keyHash: ipHash, scope } });
  return true;
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!isLinePhoneAutoAttachEnabled()) {
    return apiError(404, {
      error: "LINE通知登録は現在利用できません",
      code: "LINE_CUSTOMER_LINK_DISABLED",
      requestId,
    });
  }

  const securityError = enforceWriteRequestSecurity(request, {
    requestId,
    requireRequestedWith: false,
  });
  if (securityError) return securityError;

  try {
    await ensureLineLinkSchemaReady(prisma);
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "LINE通知登録の準備が完了していません",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }
    throw error;
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      requestId,
    });
  }

  const ipHash = hashClientIp(getClientIp(request));
  try {
    const allowed = await enforceCustomerLinkRateLimit(ipHash);
    if (!allowed) {
      return apiError(429, {
        error: "アクセスが集中しています。時間をおいて再度お試しください。",
        code: "RATE_LIMITED",
        requestId,
      });
    }
  } catch (error) {
    logError("line.customer_link.rate_limit_failed", {
      requestId,
      route: "/api/line/customer-link",
      errorCode: "RATE_LIMIT_CHECK_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "LINE通知登録の初期化に失敗しました",
      code: "RATE_LIMIT_CHECK_FAILED",
      requestId,
    });
  }

  const lineUserId = await verifyLineIdToken(parsed.data.lineIdToken);
  if (!lineUserId) {
    return apiError(401, {
      error: "LINE認証に失敗しました。再度お試しください。",
      code: "LINE_ID_TOKEN_INVALID",
      requestId,
    });
  }

  const normalizedPhone = normalizeReservationPhone(parsed.data.phone);
  if (normalizedPhone.length < 6) {
    return apiError(400, {
      error: "電話番号を確認してください",
      code: "PHONE_INVALID",
      requestId,
    });
  }

  const pushResult = await canPushToLineUser(lineUserId);
  if (pushResult.status === "BLOCKED") {
    return apiError(409, {
      error: "LINE公式アカウントの友だち追加が確認できませんでした。",
      code: "LINE_FRIEND_REQUIRED",
      requestId,
    });
  }

  const now = new Date();
  const normalizedPhoneHash = hashNormalizedPhone(normalizedPhone);

  await prisma.$transaction(async (tx) => {
    await tx.lineFriend.upsert({
      where: { lineUserId },
      create: {
        lineUserId,
        friendshipStatus: "FRIEND",
        followedAt: now,
        lastEventAt: now,
        updatedAt: now,
      },
      update: {
        friendshipStatus: "FRIEND",
        lastEventAt: now,
        updatedAt: now,
      },
    });

    await tx.lineCustomerLink.upsert({
      where: {
        lineUserId_normalizedPhoneHash: { lineUserId, normalizedPhoneHash },
      },
      create: {
        lineUserId,
        normalizedPhoneHash,
        consentedAt: now,
        lastLinkedAt: now,
        status: "ACTIVE",
      },
      update: {
        lastLinkedAt: now,
        status: "ACTIVE",
      },
    });
  });

  logInfo("line.customer_link.registered", {
    requestId,
    route: "/api/line/customer-link",
    context: { pushStatus: pushResult.status },
  });

  return NextResponse.json({ ok: true, lineNotification: { enabled: true } });
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!isLinePhoneAutoAttachEnabled()) {
    return NextResponse.json({ ok: true, lineNotification: { enabled: false } });
  }

  const securityError = enforceWriteRequestSecurity(request, {
    requestId,
    requireRequestedWith: false,
  });
  if (securityError) return securityError;

  try {
    await ensureLineLinkSchemaReady(prisma);
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "LINE通知登録の準備が完了していません",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }
    throw error;
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      requestId,
    });
  }

  const lineUserId = await verifyLineIdToken(parsed.data.lineIdToken);
  if (!lineUserId) {
    return apiError(401, {
      error: "LINE認証に失敗しました。再度お試しください。",
      code: "LINE_ID_TOKEN_INVALID",
      requestId,
    });
  }

  const normalizedPhone = normalizeReservationPhone(parsed.data.phone);
  if (normalizedPhone.length < 6) {
    return apiError(400, {
      error: "電話番号を確認してください",
      code: "PHONE_INVALID",
      requestId,
    });
  }

  const normalizedPhoneHash = hashNormalizedPhone(normalizedPhone);
  const now = new Date();
  const updated = await prisma.lineCustomerLink.updateMany({
    where: {
      lineUserId,
      normalizedPhoneHash,
      status: "ACTIVE",
    },
    data: {
      status: "REVOKED",
      lastLinkedAt: now,
    },
  });

  logInfo("line.customer_link.revoked", {
    requestId,
    route: "/api/line/customer-link",
    context: { revokedCount: updated.count },
  });

  return NextResponse.json({ ok: true, lineNotification: { enabled: false } });
}
