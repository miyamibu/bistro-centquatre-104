import { randomUUID } from "node:crypto";
import {
  Prisma,
  ReservationStatus,
  ReservationType,
  ReservationEmailNotificationType,
  ReservationEmailOutboxStatus,
} from "@prisma/client";
import { sendCustomerReservationEmail, sendReservationEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { buildReservationManagementUrl } from "@/lib/reservation-management-token";
import { deriveReservationScopedToken } from "@/lib/reservation-token";

const CRON_ROUTE = "/api/crons/process-reservation-emails";
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MINUTES = 60;
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;
const MIN_DEADLINE_MS = 250;
const DEFAULT_DEADLINE_MS = 8_000;
const MAX_DEADLINE_MS = 15_000;
const IDEMPOTENCY_KEY_PREFIX = "reservation-email-outbox/";

class ReservationEmailDeliveryError extends Error {
  readonly code: string;

  constructor(reason: string) {
    super("Reservation confirmation email was not accepted by the provider");
    this.name = "ReservationEmailDeliveryError";
    this.code = `DELIVERY_${reason.replace(/[^A-Z0-9_]/gi, "_").toUpperCase()}`;
  }
}

class ReservationEmailOutboxStateError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ReservationEmailOutboxStateError";
    this.code = code;
  }
}

function safeFailureCode(error: unknown): string {
  if (
    error instanceof ReservationEmailDeliveryError ||
    error instanceof ReservationEmailOutboxStateError
  ) {
    return error.code;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return `PRISMA_${error.code}`;
  }

  return "UNEXPECTED_ERROR";
}

function nextAttemptAt(attempts: number, failedAt: Date): Date {
  const backoffMinutes = Math.min(
    MAX_BACKOFF_MINUTES,
    2 ** Math.max(0, attempts - 1)
  );
  return new Date(failedAt.getTime() + backoffMinutes * 60 * 1000);
}

function buildAdminUrl(reservationId: string): string | undefined {
  const baseUrl = env.BASE_URL?.replace(/\/+$/, "");
  return baseUrl
    ? `${baseUrl}/admin/reservations/${encodeURIComponent(reservationId)}`
    : undefined;
}

export function buildReservationEmailIdempotencyKey(outboxId: string): string {
  return `${IDEMPOTENCY_KEY_PREFIX}${outboxId}`;
}

type OutboxCursor = {
  createdAt: Date;
  id: string;
};

function encodeCursor(cursor: OutboxCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
    "utf8"
  ).toString("base64url");
}

function decodeCursor(value: string | undefined): OutboxCursor | undefined {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      return undefined;
    }

    const createdAt = new Date(parsed.createdAt);
    return Number.isNaN(createdAt.getTime()) || !parsed.id
      ? undefined
      : { createdAt, id: parsed.id };
  } catch {
    return undefined;
  }
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.trunc(value as number), max));
}

export async function enqueueReservationConfirmationEmail(
  tx: Prisma.TransactionClient,
  reservationId: string
) {
  return tx.reservationEmailOutbox.upsert({
    where: {
      reservationId_notificationType: {
        reservationId,
        notificationType:
          ReservationEmailNotificationType.RESERVATION_CONFIRMATION,
      },
    },
    create: {
      reservationId,
      notificationType:
        ReservationEmailNotificationType.RESERVATION_CONFIRMATION,
      status: ReservationEmailOutboxStatus.PENDING,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      nextAttemptAt: new Date(),
    },
    // An idempotent replay must not reset SENT, DEAD_LETTER, or retry state.
    update: {},
    select: {
      id: true,
      status: true,
    },
  });
}

export async function enqueueReservationCustomerEmail(
  tx: Prisma.TransactionClient,
  reservationId: string,
  options: { reset?: boolean } = {},
) {
  return tx.reservationEmailOutbox.upsert({
    where: {
      reservationId_notificationType: {
        reservationId,
        notificationType: ReservationEmailNotificationType.CUSTOMER_CONFIRMATION,
      },
    },
    create: {
      reservationId,
      notificationType: ReservationEmailNotificationType.CUSTOMER_CONFIRMATION,
      status: ReservationEmailOutboxStatus.PENDING,
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      nextAttemptAt: new Date(),
    },
    update: options.reset
      ? {
          status: ReservationEmailOutboxStatus.PENDING,
          attempts: 0,
          nextAttemptAt: new Date(),
          claimedAt: null,
          lockedUntil: null,
          claimToken: null,
          sentAt: null,
          providerMessageId: null,
          // A manual resend must use a new provider idempotency key. Reusing
          // the original key would let providers deduplicate the resend.
          providerIdempotencyKey: `${IDEMPOTENCY_KEY_PREFIX}resend/${randomUUID()}`,
          lastError: null,
        }
      : {},
    select: { id: true, status: true },
  });
}

/** Prevent a still-pending confirmation from being sent after cancellation. */
export async function suppressReservationConfirmationEmail(
  tx: Prisma.TransactionClient,
  reservationId: string
) {
  return tx.reservationEmailOutbox.updateMany({
    where: {
      reservationId,
      notificationType: {
        in: [
          ReservationEmailNotificationType.RESERVATION_CONFIRMATION,
          ReservationEmailNotificationType.CUSTOMER_CONFIRMATION,
        ],
      },
      status: ReservationEmailOutboxStatus.PENDING,
    },
    data: {
      status: ReservationEmailOutboxStatus.DEAD_LETTER,
      nextAttemptAt: null,
      lockedUntil: null,
      claimToken: null,
      lastError: "RESERVATION_CANCELLED",
    },
  });
}

async function buildCustomerManagementUrl(reservationId: string) {
  const idempotency = await prisma.reservationIdempotency.findFirst({
    where: { reservationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { idempotencyKey: true, tokenKeyId: true },
  });
  const baseUrl = env.BASE_URL?.trim();
  if (!idempotency || !baseUrl) return null;

  const rawToken = deriveReservationScopedToken(
    "management",
    reservationId,
    idempotency.idempotencyKey,
    idempotency.tokenKeyId ?? "v1",
  );
  return buildReservationManagementUrl(baseUrl, rawToken);
}

type ProcessItemResult =
  | {
      processed: true;
      sent: true;
      reason: "SENT";
      durableState: true;
    }
  | {
      processed: true;
      sent: false;
      reason: "RETRY_SCHEDULED" | "DEAD_LETTER" | "SKIPPED";
      durableState: true;
    }
  | {
      processed: false;
      sent: false;
      reason: "CLAIM_SKIPPED";
      durableState: true;
    }
  | {
      processed: boolean;
      sent: false;
      reason: "CLAIM_FAILED" | "CLAIM_READ_FAILED" | "STATE_UPDATE_FAILED";
      durableState: false;
    };

async function processOutboxItem(
  id: string,
  requestId: string
): Promise<ProcessItemResult> {
  const claimedAt = new Date();
  const claimToken = randomUUID();
  const lockedUntil = new Date(claimedAt.getTime() + LOCK_DURATION_MS);

  let claimCount = 0;
  try {
    const claim = await prisma.reservationEmailOutbox.updateMany({
      where: {
        id,
        OR: [
          {
            status: ReservationEmailOutboxStatus.PENDING,
            nextAttemptAt: { lte: claimedAt },
          },
          {
            status: ReservationEmailOutboxStatus.PROCESSING,
            lockedUntil: { lte: claimedAt },
          },
        ],
      },
      data: {
        status: ReservationEmailOutboxStatus.PROCESSING,
        attempts: { increment: 1 },
        claimedAt,
        lockedUntil,
        claimToken,
      },
    });
    claimCount = claim.count;
  } catch (error) {
    logError("reservation_email_outbox.claim_failed", {
      requestId,
      route: CRON_ROUTE,
      errorCode: safeFailureCode(error),
      context: { outboxId: id },
    });
    return {
      processed: false,
      sent: false,
      reason: "CLAIM_FAILED",
      durableState: false,
    };
  }

  if (claimCount !== 1) {
    return {
      processed: false,
      sent: false,
      reason: "CLAIM_SKIPPED",
      durableState: true,
    };
  }

  let claimed;
  try {
    claimed = await prisma.reservationEmailOutbox.findFirst({
      where: {
        id,
        status: ReservationEmailOutboxStatus.PROCESSING,
        claimToken,
      },
      include: {
        reservation: true,
      },
    });
  } catch (error) {
    logError("reservation_email_outbox.claim_read_failed", {
      requestId,
      route: CRON_ROUTE,
      errorCode: safeFailureCode(error),
      context: { outboxId: id },
    });
    return {
      processed: true,
      sent: false,
      reason: "CLAIM_READ_FAILED",
      durableState: false,
    };
  }

  if (!claimed) {
    logError("reservation_email_outbox.claim_read_failed", {
      requestId,
      route: CRON_ROUTE,
      errorCode: "CLAIMED_ROW_NOT_FOUND",
      context: { outboxId: id },
    });
    return {
      processed: true,
      sent: false,
      reason: "CLAIM_READ_FAILED",
      durableState: false,
    };
  }

  async function markSkipped(reason: string): Promise<ProcessItemResult> {
    try {
      const marked = await prisma.reservationEmailOutbox.updateMany({
        where: {
          id,
          status: ReservationEmailOutboxStatus.PROCESSING,
          claimToken,
        },
        data: {
          status: ReservationEmailOutboxStatus.SKIPPED,
          nextAttemptAt: null,
          lockedUntil: null,
          claimToken: null,
          lastError: reason,
        },
      });

      if (marked.count === 1) {
        return {
          processed: true,
          sent: false,
          reason: "SKIPPED",
          durableState: true,
        };
      }
    } catch (error) {
      logError("reservation_email_outbox.skip_update_failed", {
        requestId,
        route: CRON_ROUTE,
        errorCode: safeFailureCode(error),
        context: { outboxId: id, reason },
      });
      return {
        processed: true,
        sent: false,
        reason: "STATE_UPDATE_FAILED",
        durableState: false,
      };
    }

    logError("reservation_email_outbox.skip_update_failed", {
      requestId,
      route: CRON_ROUTE,
      errorCode: "CLAIM_OWNERSHIP_LOST",
      context: { outboxId: id, reason },
    });
    return {
      processed: true,
      sent: false,
      reason: "STATE_UPDATE_FAILED",
      durableState: false,
    };
  }

  const reservation = claimed.reservation;
  if (reservation.reservationType !== ReservationType.NORMAL) {
    return markSkipped(`SKIPPED_RESERVATION_TYPE_${reservation.reservationType}`);
  }

  if (reservation.status !== ReservationStatus.CONFIRMED) {
    return markSkipped(`SKIPPED_RESERVATION_STATUS_${reservation.status}`);
  }

  const isCustomerDelivery =
    claimed.notificationType === ReservationEmailNotificationType.CUSTOMER_CONFIRMATION;
  if (isCustomerDelivery && !reservation.customerEmail) {
    return markSkipped("SKIPPED_MISSING_CUSTOMER_EMAIL");
  }

  // Keep one key across provider retries, but allow an explicit resend to
  // provide the fresh key written by enqueueReservationCustomerEmail(reset).
  const providerIdempotencyKey =
    claimed.providerIdempotencyKey ?? buildReservationEmailIdempotencyKey(id);
  let providerMessageId: string | undefined = claimed.providerMessageId ?? undefined;

  try {
    const managementUrl = isCustomerDelivery
      ? await buildCustomerManagementUrl(claimed.reservationId)
      : undefined;
    const delivery = isCustomerDelivery
      ? await sendCustomerReservationEmail({
          reservation,
          managementUrl: managementUrl ?? undefined,
          idempotencyKey: providerIdempotencyKey,
        })
      : await sendReservationEmail({
          reservation,
          adminUrl: buildAdminUrl(claimed.reservationId),
          idempotencyKey: providerIdempotencyKey,
        });

    if (!("sent" in delivery) || delivery.sent !== true) {
      const reason =
        "reason" in delivery && typeof delivery.reason === "string"
          ? delivery.reason
          : "NOT_SENT";

      if (
        reason === "PRIVATE_BLOCK" ||
        reason === "RESERVATION_NOT_CONFIRMED" ||
        reason === "MISSING_CUSTOMER_EMAIL" ||
        reason === "MISSING_MANAGEMENT_URL"
      ) {
        return markSkipped(`SKIPPED_${reason}`);
      }

      throw new ReservationEmailDeliveryError(reason);
    }

    providerMessageId = delivery.providerMessageId ?? providerMessageId;

    const sentAt = new Date();
    const marked = await prisma.reservationEmailOutbox.updateMany({
      where: {
        id,
        status: ReservationEmailOutboxStatus.PROCESSING,
        claimToken,
      },
      data: {
        status: ReservationEmailOutboxStatus.SENT,
        sentAt,
        nextAttemptAt: null,
        lockedUntil: null,
        claimToken: null,
        providerMessageId: providerMessageId ?? null,
        providerIdempotencyKey,
        lastError: null,
      },
    });

    if (marked.count !== 1) {
      throw new ReservationEmailOutboxStateError("MARK_SENT_FAILED");
    }

    return {
      processed: true,
      sent: true,
      reason: "SENT",
      durableState: true,
    };
  } catch (error) {
    const failedAt = new Date();
    const status =
      claimed.attempts >= claimed.maxAttempts
        ? ReservationEmailOutboxStatus.DEAD_LETTER
        : ReservationEmailOutboxStatus.PENDING;
    const failureCode = safeFailureCode(error);

    let markedCount = 0;
    try {
      const marked = await prisma.reservationEmailOutbox.updateMany({
        where: {
          id,
          status: ReservationEmailOutboxStatus.PROCESSING,
          claimToken,
        },
        data: {
          status,
          nextAttemptAt:
            status === ReservationEmailOutboxStatus.DEAD_LETTER
              ? null
              : nextAttemptAt(claimed.attempts, failedAt),
          lockedUntil: null,
          claimToken: null,
          ...(providerMessageId ? { providerMessageId } : {}),
          providerIdempotencyKey,
          lastError: failureCode,
        },
      });
      markedCount = marked.count;
    } catch (markError) {
      logError("reservation_email_outbox.state_update_failed", {
        requestId,
        route: CRON_ROUTE,
        errorCode: safeFailureCode(markError),
        context: { outboxId: id },
      });
      return {
        processed: true,
        sent: false,
        reason: "STATE_UPDATE_FAILED",
        durableState: false,
      };
    }

    if (markedCount !== 1) {
      logError("reservation_email_outbox.state_update_failed", {
        requestId,
        route: CRON_ROUTE,
        errorCode: "CLAIM_OWNERSHIP_LOST",
        context: { outboxId: id },
      });
      return {
        processed: true,
        sent: false,
        reason: "STATE_UPDATE_FAILED",
        durableState: false,
      };
    }

    if (status === ReservationEmailOutboxStatus.DEAD_LETTER) {
      logError("reservation_email_outbox.dead_letter", {
        requestId,
        route: CRON_ROUTE,
        errorCode: failureCode,
        context: {
          outboxId: id,
          reservationId: claimed.reservationId,
          attempts: claimed.attempts,
        },
      });
      return {
        processed: true,
        sent: false,
        reason: "DEAD_LETTER",
        durableState: true,
      };
    }

    logWarn("reservation_email_outbox.retry_scheduled", {
      requestId,
      route: CRON_ROUTE,
      errorCode: failureCode,
      context: {
        outboxId: id,
        reservationId: claimed.reservationId,
        attempts: claimed.attempts,
      },
    });
    return {
      processed: true,
      sent: false,
      reason: "RETRY_SCHEDULED",
      durableState: true,
    };
  }
}

export async function processReservationEmailOutbox(input: {
  requestId: string;
  limit?: number;
  batchSize?: number;
  cursor?: string;
  deadlineMs?: number;
}) {
  const now = new Date();
  const batchSize = clampInteger(
    input.batchSize ?? input.limit,
    DEFAULT_BATCH_SIZE,
    1,
    MAX_BATCH_SIZE
  );
  const deadlineMs = clampInteger(
    input.deadlineMs,
    DEFAULT_DEADLINE_MS,
    MIN_DEADLINE_MS,
    MAX_DEADLINE_MS
  );
  const deadlineAt = Date.now() + deadlineMs;
  const cursor = decodeCursor(input.cursor);

  const candidates = await prisma.reservationEmailOutbox.findMany({
    where: {
      AND: [
        {
          OR: [
            {
              status: ReservationEmailOutboxStatus.PENDING,
              nextAttemptAt: { lte: now },
            },
            {
              status: ReservationEmailOutboxStatus.PROCESSING,
              lockedUntil: { lte: now },
            },
          ],
        },
        ...(cursor
          ? [
              {
                OR: [
                  { createdAt: { gt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { id: true, createdAt: true },
  });

  let sent = 0;
  let failed = 0;
  let deadLetter = 0;
  let skipped = 0;
  let unsafe = 0;
  let deadlineReached = false;
  let lastCursor: OutboxCursor | undefined;
  let cursorSafe = true;

  // Keep provider pressure bounded and claim each row independently.
  for (const candidate of candidates) {
    if (Date.now() >= deadlineAt) {
      deadlineReached = true;
      break;
    }

    const result = await processOutboxItem(candidate.id, input.requestId);
    lastCursor = {
      createdAt:
        candidate.createdAt instanceof Date ? candidate.createdAt : now,
      id: candidate.id,
    };
    if (result.sent) {
      sent += 1;
    } else if (!result.durableState) {
      unsafe += 1;
      cursorSafe = false;
    } else if (result.reason === "DEAD_LETTER") {
      deadLetter += 1;
    } else if (result.reason === "SKIPPED") {
      skipped += 1;
    } else if (result.reason === "RETRY_SCHEDULED" || result.reason === "CLAIM_SKIPPED") {
      cursorSafe = false;
      if (result.processed) {
        failed += 1;
      } else {
        skipped += 1;
      }
    } else if (result.processed) {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  const summary = {
    scanned: candidates.length,
    sent,
    failed,
    deadLetter,
    skipped,
    unsafe,
    deadlineReached,
    nextCursor:
      cursorSafe && (deadlineReached || candidates.length === batchSize)
        ? lastCursor
          ? encodeCursor(lastCursor)
          : input.cursor ?? null
        : null,
  };

  logInfo("reservation_email_outbox.processed", {
    requestId: input.requestId,
    route: CRON_ROUTE,
    context: summary,
  });

  return summary;
}
