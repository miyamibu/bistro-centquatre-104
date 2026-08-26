-- Free-tier scheduler observability and administrator-triggered drain audit.
-- These tables contain no reservation/order PII or secret values.
CREATE TABLE "SchedulerHeartbeat" (
    "id" TEXT NOT NULL,
    "schedulerKind" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3) NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "deadLetterCount" INTEGER NOT NULL DEFAULT 0,
    "backlogCount" INTEGER NOT NULL DEFAULT 0,
    "oldestBacklogAt" TIMESTAMP(3),
    "lastRunId" TEXT,
    "lastProviderCronAt" TIMESTAMP(3),
    "immediateAttempts" INTEGER NOT NULL DEFAULT 0,
    "immediateSuccesses" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulerHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxDrainAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorEmail" TEXT,
    "actorRole" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "lane" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "requestedLimit" INTEGER NOT NULL,
    "scannedCount" INTEGER NOT NULL,
    "sentCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "deadLetterCount" INTEGER NOT NULL,
    "backlogCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxDrainAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchedulerHeartbeat_schedulerKind_lane_key"
ON "SchedulerHeartbeat"("schedulerKind", "lane");

CREATE INDEX "SchedulerHeartbeat_lane_updatedAt_idx"
ON "SchedulerHeartbeat"("lane", "updatedAt");

CREATE INDEX "OutboxDrainAuditLog_createdAt_idx"
ON "OutboxDrainAuditLog"("createdAt");

CREATE INDEX "OutboxDrainAuditLog_actorUserId_createdAt_idx"
ON "OutboxDrainAuditLog"("actorUserId", "createdAt");

-- Both tables live in Supabase's public schema, so RLS is mandatory even
-- though application access normally uses Prisma's server-only connection.
ALTER TABLE "SchedulerHeartbeat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxDrainAuditLog" ENABLE ROW LEVEL SECURITY;
