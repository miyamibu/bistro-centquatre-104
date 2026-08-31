-- Durable LINE webhook inbox.
-- Events are inserted before handler execution and keyed by LINE's
-- webhookEventId so duplicate deliveries can be acknowledged safely.

CREATE TYPE "LineWebhookInboxStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'PROCESSED',
    'FAILED'
);

CREATE TABLE "LineWebhookInbox" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "LineWebhookInboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "claimToken" TEXT,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineWebhookInbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LineWebhookInbox_eventId_key"
ON "LineWebhookInbox"("eventId");

CREATE INDEX "LineWebhookInbox_status_lockedUntil_idx"
ON "LineWebhookInbox"("status", "lockedUntil");

CREATE INDEX "LineWebhookInbox_createdAt_idx"
ON "LineWebhookInbox"("createdAt");

-- Fail closed for public Data API roles until explicit service-role policy
-- configuration is applied.
ALTER TABLE "LineWebhookInbox" ENABLE ROW LEVEL SECURITY;
