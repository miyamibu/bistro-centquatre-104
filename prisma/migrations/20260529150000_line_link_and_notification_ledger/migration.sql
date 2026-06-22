-- Migration: LINE link tokens, notification event ledger, LINE friend tracking

-- Add new optional fields to Reservation
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "lineLinkedAt"    TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "lineLinkSource"  TEXT;
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "linePushStatus"  TEXT;
ALTER TABLE "Reservation" ADD COLUMN IF NOT EXISTS "linePushCheckedAt" TIMESTAMP(3);

-- ReservationLineLinkToken: one-time post-reservation LINE link tokens
CREATE TABLE IF NOT EXISTS "ReservationLineLinkToken" (
    "id"            TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "tokenHash"     TEXT NOT NULL,
    "expiresAt"     TIMESTAMP(3) NOT NULL,
    "usedAt"        TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReservationLineLinkToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReservationLineLinkToken_tokenHash_key"
    ON "ReservationLineLinkToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "ReservationLineLinkToken_reservationId_idx"
    ON "ReservationLineLinkToken"("reservationId");

CREATE INDEX IF NOT EXISTS "ReservationLineLinkToken_expiresAt_idx"
    ON "ReservationLineLinkToken"("expiresAt");

ALTER TABLE "ReservationLineLinkToken"
    DROP CONSTRAINT IF EXISTS "ReservationLineLinkToken_reservationId_fkey";
ALTER TABLE "ReservationLineLinkToken"
    ADD CONSTRAINT "ReservationLineLinkToken_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- LineFriend: LINE Official Account friendship status per userId
CREATE TABLE IF NOT EXISTS "LineFriend" (
    "lineUserId"       TEXT NOT NULL,
    "friendshipStatus" TEXT NOT NULL,
    "followedAt"       TIMESTAMP(3),
    "unfollowedAt"     TIMESTAMP(3),
    "lastEventAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LineFriend_pkey" PRIMARY KEY ("lineUserId")
);

-- NotificationEvent: durable ledger and cron concurrency guard
CREATE TABLE IF NOT EXISTS "NotificationEvent" (
    "id"            TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "channel"       TEXT NOT NULL,
    "type"          TEXT NOT NULL,
    "targetDate"    TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'PENDING',
    "retryKey"      TEXT NOT NULL,
    "claimedAt"     TIMESTAMP(3),
    "sentAt"        TIMESTAMP(3),
    "error"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationEvent_retryKey_key"
    ON "NotificationEvent"("retryKey");

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationEvent_reservationId_channel_type_targetDate_key"
    ON "NotificationEvent"("reservationId", "channel", "type", "targetDate");

CREATE INDEX IF NOT EXISTS "NotificationEvent_status_targetDate_idx"
    ON "NotificationEvent"("status", "targetDate");

ALTER TABLE "NotificationEvent"
    DROP CONSTRAINT IF EXISTS "NotificationEvent_reservationId_fkey";
ALTER TABLE "NotificationEvent"
    ADD CONSTRAINT "NotificationEvent_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- LineCustomerLink: optional future reuse by phone hash with explicit consent
CREATE TABLE IF NOT EXISTS "LineCustomerLink" (
    "id"                  TEXT NOT NULL,
    "lineUserId"          TEXT NOT NULL,
    "normalizedPhoneHash" TEXT NOT NULL,
    "consentedAt"         TIMESTAMP(3) NOT NULL,
    "lastLinkedAt"        TIMESTAMP(3) NOT NULL,
    "status"              TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LineCustomerLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LineCustomerLink_lineUserId_normalizedPhoneHash_key"
    ON "LineCustomerLink"("lineUserId", "normalizedPhoneHash");

CREATE INDEX IF NOT EXISTS "LineCustomerLink_normalizedPhoneHash_idx"
    ON "LineCustomerLink"("normalizedPhoneHash");

-- These tables live in Supabase's exposed public schema. The application uses
-- server-side database access; public Data API roles should not read or mutate
-- these operational LINE/linking records without explicit policies.
ALTER TABLE "ReservationLineLinkToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineFriend" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LineCustomerLink" ENABLE ROW LEVEL SECURITY;
