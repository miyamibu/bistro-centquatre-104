import { NextRequest, NextResponse } from "next/server";
import { Prisma, ReservationStatus, ReservationType } from "@prisma/client";
import { z } from "zod";
import { apiError, readLimitedJson } from "@/lib/api-security";
import { getContactPayload } from "@/lib/contact";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";
import {
  hashReservationManagementToken,
  isReservationManagementTokenFormatValid,
} from "@/lib/reservation-management-token";
import { evaluateSelfServiceCancellation } from "@/lib/cancellation-policy";
import {
  enqueueReservationCustomerEmail,
  ReservationEmailOutboxBusyError,
  suppressReservationConfirmationEmail,
} from "@/lib/reservation-email-outbox";
import { getClientIp, getUserAgent, hashClientIp } from "@/lib/request-meta";
import { getRequestId, logError, logInfo } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MANAGEMENT_RATE_LIMIT_SCOPE = "RESERVATION_MANAGEMENT";
const MANAGEMENT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const MANAGEMENT_RATE_LIMIT_MAX = 30;

const managementRequestSchema = z
  .object({
    token: z
      .string()
      .refine(isReservationManagementTokenFormatValid, "予約管理リンクが不正です"),
    reservationId: z.string().trim().min(1).max(64).optional(),
    action: z.enum(["lookup", "cancel", "resend"]).default("lookup"),
  })
  .strict();

const reservationSelect = {
  id: true,
  date: true,
  servicePeriod: true,
  reservationType: true,
  partySize: true,
  arrivalTime: true,
  name: true,
  customerEmail: true,
  note: true,
  status: true,
} as const;

type ManagedReservation = Prisma.ReservationGetPayload<{
  select: typeof reservationSelect;
}>;

function toPublicReservation(reservation: ManagedReservation) {
  return {
    id: reservation.id,
    date: reservation.date,
    servicePeriod: reservation.servicePeriod,
    partySize: reservation.partySize,
    arrivalTime: reservation.arrivalTime,
    name: reservation.name,
    note: reservation.note,
    status: reservation.status,
  };
}

type ManagementResult =
  | {
      ok: true;
      reservation: ManagedReservation;
      alreadyCancelled: boolean;
      customerEmailQueued?: boolean;
    }
  | {
      ok: false;
      status: number;
      code: string;
      error: string;
    };

async function enforceManagementRateLimit(ipHash: string) {
  const since = new Date(Date.now() - MANAGEMENT_RATE_LIMIT_WINDOW_MS);
  const count = await prisma.reservationRateLimitEvent.count({
    where: {
      keyHash: ipHash,
      scope: MANAGEMENT_RATE_LIMIT_SCOPE,
      createdAt: { gte: since },
    },
  });

  if (count >= MANAGEMENT_RATE_LIMIT_MAX) return false;

  await prisma.reservationRateLimitEvent.create({
    data: {
      keyHash: ipHash,
      scope: MANAGEMENT_RATE_LIMIT_SCOPE,
    },
  });
  return true;
}

function invalidTokenResult(): ManagementResult {
  return {
    ok: false,
    status: 404,
    code: "MANAGEMENT_TOKEN_INVALID",
    error: "予約管理リンクが無効か、期限切れです。お電話でご確認ください。",
  };
}

function expiredTokenResult(): ManagementResult {
  return {
    ok: false,
    status: 410,
    code: "MANAGEMENT_TOKEN_EXPIRED",
    error: "予約管理リンクの有効期限が切れています。お電話でご確認ください。",
  };
}

async function executeManagementAction(
  tx: Prisma.TransactionClient,
  input: {
    tokenHash: string;
    reservationId?: string;
    action: "lookup" | "cancel" | "resend";
    now: Date;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  }
): Promise<ManagementResult> {
  const managementToken = await tx.reservationManagementToken.findUnique({
    where: { tokenHash: input.tokenHash },
    select: {
      id: true,
      reservationId: true,
      expiresAt: true,
      revokedAt: true,
      reservation: { select: reservationSelect },
    },
  });

  if (!managementToken) {
    return invalidTokenResult();
  }

  if (managementToken.expiresAt <= input.now) {
    return expiredTokenResult();
  }

  if (input.reservationId && input.reservationId !== managementToken.reservationId) {
    return invalidTokenResult();
  }

  const reservation = managementToken.reservation;
  if (
    reservation.reservationType !== ReservationType.NORMAL ||
    (managementToken.revokedAt && reservation.status !== ReservationStatus.CANCELLED)
  ) {
    return invalidTokenResult();
  }

  if (input.action === "lookup") {
    return {
      ok: true,
      reservation,
      alreadyCancelled: reservation.status === ReservationStatus.CANCELLED,
    };
  }

  if (input.action === "resend") {
    if (reservation.status !== ReservationStatus.CONFIRMED) {
      return {
        ok: false,
        status: 409,
        code: "RESERVATION_EMAIL_NOT_AVAILABLE",
        error: "予約確定中の予約だけ確認メールを再送できます。",
      };
    }

    if (!reservation.customerEmail) {
      return {
        ok: false,
        status: 409,
        code: "CUSTOMER_CONTACT_NOT_CONFIGURED",
        error: "この予約にはメールアドレスが登録されていません。お電話でご確認ください。",
      };
    }

    try {
      await enqueueReservationCustomerEmail(tx, reservation.id, { reset: true });
    } catch (error) {
      if (error instanceof ReservationEmailOutboxBusyError) {
        return {
          ok: false,
          status: 409,
          code: error.code,
          error: "確認メールを送信中です。しばらく待ってから状態を確認してください。",
        };
      }
      throw error;
    }
    return {
      ok: true,
      reservation,
      alreadyCancelled: false,
      customerEmailQueued: true,
    };
  }

  if (reservation.status === ReservationStatus.CANCELLED) {
    await tx.reservationManagementToken.updateMany({
      where: { reservationId: reservation.id, revokedAt: null },
      data: { revokedAt: input.now },
    });
    return {
      ok: true,
      reservation,
      alreadyCancelled: true,
    };
  }

  if (
    reservation.status === ReservationStatus.DONE ||
    reservation.status === ReservationStatus.NOSHOW
  ) {
    return {
      ok: false,
      status: 409,
      code: "RESERVATION_NOT_CANCELLABLE",
      error: "来店済み、または無断キャンセルの予約はWebから変更できません。",
    };
  }

  if (reservation.status !== ReservationStatus.CONFIRMED) {
    return {
      ok: false,
      status: 409,
      code: "RESERVATION_STATUS_CONFLICT",
      error: "予約の状態が変わったため、キャンセルできません。最新状態を確認してください。",
    };
  }

  const cancellation = evaluateSelfServiceCancellation({
    date: reservation.date,
    arrivalTime: reservation.arrivalTime,
    now: input.now,
  });
  if (!cancellation.allowed) {
    return {
      ok: false,
      status: 409,
      code: cancellation.code,
      error:
        cancellation.code === "CANCELLATION_CUTOFF_PASSED"
          ? "Webキャンセルの受付期限を過ぎています。変更・キャンセルはお電話でご相談ください。"
          : "キャンセル期限を判定できません。お電話でご相談ください。",
    };
  }

  const updatedCount = await tx.reservation.updateMany({
    where: {
      id: reservation.id,
      status: ReservationStatus.CONFIRMED,
    },
    data: {
      status: ReservationStatus.CANCELLED,
      cancelledAt: input.now,
      cancelSource: "CUSTOMER_MANAGEMENT_TOKEN",
      cancellationReason: "SELF_SERVICE",
    },
  });

  const next = await tx.reservation.findUnique({
    where: { id: reservation.id },
    select: reservationSelect,
  });

  if (updatedCount.count !== 1 || !next) {
    if (next?.status === ReservationStatus.CANCELLED) {
      await tx.reservationManagementToken.updateMany({
        where: { reservationId: reservation.id, revokedAt: null },
        data: { revokedAt: input.now },
      });
      return {
        ok: true,
        reservation: next,
        alreadyCancelled: true,
      };
    }

    return {
      ok: false,
      status: 409,
      code: "RESERVATION_STATUS_CONFLICT",
      error: "予約の状態が別の操作で変更されたため、キャンセルできません。最新状態を確認してください。",
    };
  }

  await tx.reservationStatusAuditLog.create({
    data: {
      reservationId: next.id,
      actorName: null,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      previousStatus: ReservationStatus.CONFIRMED,
      nextStatus: ReservationStatus.CANCELLED,
      reason: "CUSTOMER_MANAGEMENT_TOKEN",
    },
  });

  await suppressReservationConfirmationEmail(tx, next.id);

  await tx.reservationManagementToken.updateMany({
    where: { reservationId: next.id, revokedAt: null },
    data: { revokedAt: input.now },
  });

  return {
    ok: true,
    reservation: next,
    alreadyCancelled: false,
  };
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/reservations/manage";
  const contact = getContactPayload();

  const parsedBody = await readLimitedJson<unknown>(request, {
    requestId,
    maxBytes: 8 * 1024,
  });
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = managementRequestSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return apiError(400, {
      error: "予約管理リンクが不正です。",
      code: "MANAGEMENT_TOKEN_INVALID",
      requestId,
      ...contact,
    });
  }

  try {
    await ensureReservationSchemaReady(prisma);
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "予約管理機能の準備が完了していません。",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
        ...contact,
      });
    }
    throw error;
  }

  const ipAddress = getClientIp(request);
  const ipHash = hashClientIp(ipAddress);
  try {
    if (!(await enforceManagementRateLimit(ipHash))) {
      return apiError(429, {
        error: "アクセスが集中しています。時間をおいて再度お試しください。",
        code: "RATE_LIMITED",
        requestId,
        ...contact,
      });
    }
  } catch (error) {
    logError("reservation.management.rate_limit_failed", {
      requestId,
      route,
      errorCode: "RATE_LIMIT_CHECK_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(503, {
      error: "予約管理機能を一時的に利用できません。",
      code: "RATE_LIMIT_CHECK_FAILED",
      requestId,
      ...contact,
    });
  }

  const tokenHash = hashReservationManagementToken(parsed.data.token);
  const ipUserAgent = {
    ipAddress,
    userAgent: getUserAgent(request),
  };

  try {
    const result = await prisma.$transaction(
      (tx) =>
        executeManagementAction(tx, {
          tokenHash,
          reservationId: parsed.data.reservationId,
          action: parsed.data.action,
          now: new Date(),
          requestId,
          ...ipUserAgent,
        })
    );

    if (!result.ok) {
      return apiError(result.status, {
        error: result.error,
        code: result.code,
        requestId,
        ...contact,
      });
    }

    logInfo(
      parsed.data.action === "cancel"
        ? "reservation.management.cancelled"
        : parsed.data.action === "resend"
          ? "reservation.management.email_queued"
          : "reservation.management.looked_up",
      {
        requestId,
        route,
        context: {
          reservationId: result.reservation.id,
          status: result.reservation.status,
          alreadyCancelled: result.alreadyCancelled,
          ...(result.customerEmailQueued ? { customerEmailQueued: true } : {}),
          ipHash,
        },
      }
    );

    return NextResponse.json(
      {
        ok: true,
        reservation: toPublicReservation(result.reservation),
        alreadyCancelled: result.alreadyCancelled,
        ...(result.customerEmailQueued ? { customerEmailQueued: true } : {}),
        requestId,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      }
    );
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "予約管理機能の準備が完了していません。",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
        ...contact,
      });
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return apiError(409, {
        error: "予約の状態が別の操作で変更されたため、キャンセルできません。最新状態を確認してください。",
        code: "RESERVATION_STATUS_CONFLICT",
        requestId,
        ...contact,
      });
    }

    logError("reservation.management.failed", {
      requestId,
      route,
      errorCode: "RESERVATION_MANAGEMENT_FAILED",
      context: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return apiError(500, {
      error: "予約管理処理に失敗しました。お電話ください。",
      code: "RESERVATION_MANAGEMENT_FAILED",
      requestId,
      ...contact,
    });
  }
}
