import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const OUTBOX_LANES = ["RESERVATION_EMAIL", "ORDER_NOTIFICATION"] as const;
export type OutboxLane = (typeof OUTBOX_LANES)[number];
export type SchedulerLane = OutboxLane | "LINE_REMINDER";

export type SchedulerContext = {
  schedulerKind: "GITHUB_ACTIONS" | "PROVIDER_FAILSAFE" | "API_CRON";
  runId: string | null;
};

export type HeartbeatSummary = {
  processed: number;
  retry: number;
  deadLetter: number;
  backlog: number;
  oldestBacklogAt: Date | null;
};

function safeRunId(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : null;
}

export function readSchedulerContext(request: NextRequest): SchedulerContext {
  const kind = request.headers.get("x-scheduler-kind")?.trim().toLowerCase();
  return {
    schedulerKind:
      kind === "github-actions"
        ? "GITHUB_ACTIONS"
        : kind === "provider-failsafe"
          ? "PROVIDER_FAILSAFE"
          : "API_CRON",
    runId: safeRunId(request.headers.get("x-scheduler-run-id")),
  };
}

export async function markSchedulerStarted(
  lane: SchedulerLane,
  context: SchedulerContext,
  startedAt = new Date(),
) {
  return prisma.schedulerHeartbeat.upsert({
    where: { schedulerKind_lane: { schedulerKind: context.schedulerKind, lane } },
    create: {
      schedulerKind: context.schedulerKind,
      lane,
      lastStartedAt: startedAt,
      lastRunId: context.runId,
      ...(context.schedulerKind === "PROVIDER_FAILSAFE"
        ? { lastProviderCronAt: startedAt }
        : {}),
    },
    update: {
      lastStartedAt: startedAt,
      lastRunId: context.runId,
      ...(context.schedulerKind === "PROVIDER_FAILSAFE"
        ? { lastProviderCronAt: startedAt }
        : {}),
    },
  });
}

export async function markSchedulerSucceeded(
  lane: SchedulerLane,
  context: SchedulerContext,
  summary: HeartbeatSummary,
  finishedAt = new Date(),
) {
  return prisma.schedulerHeartbeat.update({
    where: { schedulerKind_lane: { schedulerKind: context.schedulerKind, lane } },
    data: {
      lastSuccessAt: finishedAt,
      processedCount: summary.processed,
      retryCount: summary.retry,
      deadLetterCount: summary.deadLetter,
      backlogCount: summary.backlog,
      oldestBacklogAt: summary.oldestBacklogAt,
      lastErrorCode: null,
    },
  });
}

export async function markSchedulerFailed(
  lane: SchedulerLane,
  context: SchedulerContext,
  errorCode: string,
  failedAt = new Date(),
) {
  return prisma.schedulerHeartbeat.upsert({
    where: { schedulerKind_lane: { schedulerKind: context.schedulerKind, lane } },
    create: {
      schedulerKind: context.schedulerKind,
      lane,
      lastStartedAt: failedAt,
      lastFailureAt: failedAt,
      lastRunId: context.runId,
      lastErrorCode: errorCode.slice(0, 120),
    },
    update: {
      lastFailureAt: failedAt,
      lastRunId: context.runId,
      lastErrorCode: errorCode.slice(0, 120),
    },
  });
}

export async function recordImmediateAttempt(
  lane: OutboxLane,
  success: boolean,
  summary: Pick<HeartbeatSummary, "processed" | "retry" | "deadLetter" | "backlog" | "oldestBacklogAt">,
  occurredAt = new Date(),
) {
  return prisma.schedulerHeartbeat.upsert({
    where: { schedulerKind_lane: { schedulerKind: "IMMEDIATE", lane } },
    create: {
      schedulerKind: "IMMEDIATE",
      lane,
      lastStartedAt: occurredAt,
      ...(success ? { lastSuccessAt: occurredAt } : { lastFailureAt: occurredAt }),
      processedCount: summary.processed,
      retryCount: summary.retry,
      deadLetterCount: summary.deadLetter,
      backlogCount: summary.backlog,
      oldestBacklogAt: summary.oldestBacklogAt,
      immediateAttempts: 1,
      immediateSuccesses: success ? 1 : 0,
      lastErrorCode: success ? null : "IMMEDIATE_PROCESSING_FAILED",
    },
    update: {
      lastStartedAt: occurredAt,
      ...(success ? { lastSuccessAt: occurredAt } : { lastFailureAt: occurredAt }),
      processedCount: summary.processed,
      retryCount: summary.retry,
      deadLetterCount: summary.deadLetter,
      backlogCount: summary.backlog,
      oldestBacklogAt: summary.oldestBacklogAt,
      immediateAttempts: { increment: 1 },
      ...(success ? { immediateSuccesses: { increment: 1 } } : {}),
      lastErrorCode: success ? null : "IMMEDIATE_PROCESSING_FAILED",
    },
  });
}

export async function listSchedulerHeartbeats() {
  return prisma.schedulerHeartbeat.findMany({
    orderBy: [{ lane: "asc" }, { schedulerKind: "asc" }],
  });
}
