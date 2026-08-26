import { NextRequest, NextResponse } from "next/server";
import { ReservationStatus, ReservationType } from "@prisma/client";
import { addDays } from "date-fns";
import { prisma } from "@/lib/prisma";
import {
  formatJst,
  getJstDayOfMonth,
  startOfJstMonth,
  todayJst,
} from "@/lib/dates";
import { env, hasLineMessagingEnv } from "@/lib/env";
import { apiError } from "@/lib/api-security";
import { isBearerSecretAuthorized } from "@/lib/bearer-auth";
import { getRequestId, logError, logInfo, logWarn } from "@/lib/logger";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  findReservationsCompat,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";
import {
  getLineMonthlyQuotaConsumption,
} from "@/lib/line";
import { claimAndSendLineReminder } from "@/lib/line-notification";
import {
  markSchedulerFailed,
  markSchedulerStarted,
  markSchedulerSucceeded,
  readSchedulerContext,
} from "@/lib/scheduler-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Configurable via env; defaults match LINE free tier limits.
const FREE_TIER_HARD_LIMIT = env.LINE_MONTHLY_REMINDER_LIMIT ?? 200;
const FREE_TIER_WARN_THRESHOLD = env.LINE_MONTHLY_REMINDER_WARN_THRESHOLD ?? 180;
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const MIN_DEADLINE_MS = 250;
const DEFAULT_DEADLINE_MS = 8_000;
const MAX_DEADLINE_MS = 15_000;

type ReminderCursor = { createdAt: Date; id: string };

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.trunc(value as number), max));
}

function decodeCursor(value: string | undefined): ReminderCursor | undefined {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return undefined;
    const createdAt = new Date(parsed.createdAt);
    return Number.isNaN(createdAt.getTime()) || !parsed.id
      ? undefined
      : { createdAt, id: parsed.id };
  } catch {
    return undefined;
  }
}

function encodeCursor(cursor: ReminderCursor): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }),
    "utf8"
  ).toString("base64url");
}

function isCronAuthorized(request: NextRequest) {
  return isBearerSecretAuthorized(request.headers.get("authorization"), env.CRON_SECRET);
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function countMonthlyRemindersSent(): Promise<number> {
  const monthStart = startOfJstMonth(todayJst());
  return prisma.reservation.count({
    where: { lineReminderSentAt: { gte: monthStart } },
  });
}

async function executeReminderCron(input: {
  batchSize?: number;
  cursor?: string;
  deadlineMs?: number;
} = {}) {
  await ensureReservationSchemaReady(prisma);

  const today = todayJst();
  const tomorrow = addDays(today, 1);
  const target = formatJst(tomorrow);
  const batchSize = clampInteger(input.batchSize, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const deadlineMs = clampInteger(
    input.deadlineMs,
    DEFAULT_DEADLINE_MS,
    MIN_DEADLINE_MS,
    MAX_DEADLINE_MS
  );
  const deadlineAt = Date.now() + deadlineMs;
  const cursor = decodeCursor(input.cursor);

  const candidates = await findReservationsCompat(prisma, {
    where: {
      AND: [
        {
          date: target,
          status: ReservationStatus.CONFIRMED,
          reservationType: ReservationType.NORMAL,
          lineUserId: { not: null },
          lineReminderSentAt: null,
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
  });

  if (!hasLineMessagingEnv()) {
    logInfo("crons.remind.skipped.line_not_configured", {
      route: "/api/crons/remind",
      context: { date: target, count: candidates.length },
    });
    return NextResponse.json({
      status: "SKIPPED_LINE_SETUP",
      date: target,
      count: candidates.length,
      nextCursor: null,
      deadlineReached: false,
    });
  }

  // Day-1 of the JST month: log approximate quota consumption (observability only).
  if (getJstDayOfMonth(today) === 1) {
    const usage = await getLineMonthlyQuotaConsumption();
    logInfo("crons.remind.quota_snapshot", {
      route: "/api/crons/remind",
      context: { usage },
    });
  }

  const monthlySentBefore = await countMonthlyRemindersSent();
  if (monthlySentBefore >= FREE_TIER_WARN_THRESHOLD) {
    logWarn("crons.remind.quota_warning", {
      route: "/api/crons/remind",
      context: { monthlySentBefore },
    });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let skippedQuota = 0;
  let deadlineReached = false;
  let lastCursor: ReminderCursor | undefined;
  let cursorSafe = true;

  // Sequential dispatch keeps provider pressure bounded. The DB claim and quota
  // reservation remain atomic even when this route is invoked concurrently.
  for (const reservation of candidates) {
    if (Date.now() >= deadlineAt) {
      deadlineReached = true;
      break;
    }

    lastCursor = {
      createdAt: reservation.createdAt,
      id: reservation.id,
    };

    if (!reservation.lineUserId) continue;

    const outcome = await claimAndSendLineReminder(
      reservation.id,
      reservation.lineUserId,
      target,
      "CRON",
      { monthlyQuota: FREE_TIER_HARD_LIMIT }
    );

    if (outcome === "sent") {
      sent += 1;
    } else if (outcome === "failed") {
      failed += 1;
      cursorSafe = false;
    } else if (outcome === "quota") {
      skippedQuota += 1;
    } else {
      skipped += 1;
      cursorSafe = false;
    }
  }

  logInfo("crons.remind.completed", {
    route: "/api/crons/remind",
    context: {
      date: target,
      totalCandidates: candidates.length,
      sent,
      failed,
      skipped,
      skippedQuota,
      monthlySentBefore,
      deadlineReached,
    },
  });

  return NextResponse.json({
    ok: true,
    targetDate: target,
    totalCandidates: candidates.length,
    sent,
    failed,
    skipped,
    skippedQuota,
    monthlySentBefore,
    deadlineReached,
    nextCursor:
      cursorSafe && (deadlineReached || candidates.length === batchSize)
        ? lastCursor
          ? encodeCursor(lastCursor)
          : input.cursor ?? null
        : null,
  });
}

async function executeRemind(request: NextRequest) {
  const requestId = getRequestId(request);
  if (!isCronAuthorized(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const scheduler = readSchedulerContext(request);
  try {
    await markSchedulerStarted("LINE_REMINDER", scheduler);
    const params = request.nextUrl.searchParams;
    const batchSize = parsePositiveInteger(params.get("batchSize"));
    const deadlineMs = parsePositiveInteger(params.get("deadlineMs"));
    const cursor = params.get("cursor")?.trim();
    const response = await executeReminderCron({
      ...(batchSize ? { batchSize } : {}),
      ...(deadlineMs ? { deadlineMs } : {}),
      ...(cursor && cursor.length <= 512 ? { cursor } : {}),
    });
    const body = (await response.clone().json().catch(() => ({}))) as {
      sent?: number;
      failed?: number;
      skipped?: number;
      nextCursor?: string | null;
    };
    if (response.ok && !body.failed) {
      await markSchedulerSucceeded("LINE_REMINDER", scheduler, {
        processed: (body.sent ?? 0) + (body.skipped ?? 0),
        retry: 0,
        deadLetter: 0,
        backlog: body.nextCursor ? 1 : 0,
        oldestBacklogAt: null,
      });
    } else {
      await markSchedulerFailed("LINE_REMINDER", scheduler, "CRON_REMIND_PARTIAL_FAILURE");
      return apiError(500, {
        ...body,
        error: "Reminder cron partially failed",
        code: "CRON_REMIND_PARTIAL_FAILURE",
        requestId,
      });
    }
    return response;
  } catch (error) {
    await markSchedulerFailed("LINE_REMINDER", scheduler, "CRON_REMIND_FAILED").catch(
      () => undefined
    );
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    logError("crons.remind.failed", {
      requestId,
      route: "/api/crons/remind",
      errorCode: "CRON_REMIND_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Cron execution failed",
      code: "CRON_REMIND_FAILED",
      requestId,
    });
  }
}

export async function POST(request: NextRequest) {
  return executeRemind(request);
}

// The free GitHub scheduler calls this route via HTTP GET and follows
// nextCursor until null. Authorization remains a CRON_SECRET bearer check.
export async function GET(request: NextRequest) {
  return executeRemind(request);
}
