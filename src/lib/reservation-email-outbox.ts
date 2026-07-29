import { randomUUID } from "node:crypto";
import {
  Prisma,
  ReservationEmailNotificationType,
  ReservationEmailOutboxStatus,
} from "@prisma/client";
import { sendReservationEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { logError, logInfo, logWarn } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const CRON_ROUTE = "/api/crons/process-reservation-emails";
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MINUTES = 60;

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
      reason: "RETRY_SCHEDULED" | "DEAD_LETTER";
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

  try {
    const delivery = await sendReservationEmail({
      reservation: claimed.reservation,
      adminUrl: buildAdminUrl(claimed.reservationId),
    });

    if (!("sent" in delivery) || delivery.sent !== true) {
      const reason =
        "reason" in delivery && typeof delivery.reason === "string"
          ? delivery.reason
          : "NOT_SENT";
      throw new ReservationEmailDeliveryError(reason);
    }

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
}) {
  const now = new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const candidates = await prisma.reservationEmailOutbox.findMany({
    where: {
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
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true },
  });

  let sent = 0;
  let failed = 0;
  let deadLetter = 0;
  let skipped = 0;
  let unsafe = 0;

  // Keep provider pressure bounded and claim each row independently.
  for (const candidate of candidates) {
    const result = await processOutboxItem(candidate.id, input.requestId);
    if (result.sent) {
      sent += 1;
    } else if (!result.durableState) {
      unsafe += 1;
    } else if (result.reason === "DEAD_LETTER") {
      deadLetter += 1;
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
  };

  logInfo("reservation_email_outbox.processed", {
    requestId: input.requestId,
    route: CRON_ROUTE,
    context: summary,
  });

  return summary;
}
