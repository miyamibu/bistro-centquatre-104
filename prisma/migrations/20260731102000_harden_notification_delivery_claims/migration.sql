-- Fence stale notification workers and retain provider acceptance evidence.

ALTER TYPE "ReservationEmailOutboxStatus"
    ADD VALUE IF NOT EXISTS 'SKIPPED' BEFORE 'DEAD_LETTER';

ALTER TABLE "ReservationEmailOutbox"
    ADD COLUMN "providerMessageId" TEXT,
    ADD COLUMN "providerIdempotencyKey" TEXT;

ALTER TABLE "NotificationEvent"
    ADD COLUMN "claimToken" TEXT;

CREATE INDEX "NotificationEvent_claimToken_idx"
ON "NotificationEvent"("claimToken");
