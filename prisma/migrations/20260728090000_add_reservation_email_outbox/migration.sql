-- Durable reservation confirmation email outbox.
-- The reservation row and its email intent are created in the same transaction.

CREATE TYPE "ReservationEmailOutboxStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'SENT',
    'DEAD_LETTER'
);

CREATE TYPE "ReservationEmailNotificationType" AS ENUM (
    'RESERVATION_CONFIRMATION'
);

CREATE TABLE "ReservationEmailOutbox" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "notificationType" "ReservationEmailNotificationType" NOT NULL,
    "status" "ReservationEmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "claimToken" TEXT,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationEmailOutbox_pkey" PRIMARY KEY ("id")
);

-- Fail closed if the separately managed Supabase policy SQL has not yet been
-- applied. PostgreSQL denies non-owner roles when RLS is enabled without a
-- matching policy, while the migration owner can still complete this migration.
ALTER TABLE "ReservationEmailOutbox" ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX "ReservationEmailOutbox_reservationId_notificationType_key"
ON "ReservationEmailOutbox"("reservationId", "notificationType");

CREATE INDEX "ReservationEmailOutbox_status_nextAttemptAt_idx"
ON "ReservationEmailOutbox"("status", "nextAttemptAt");

CREATE INDEX "ReservationEmailOutbox_status_lockedUntil_idx"
ON "ReservationEmailOutbox"("status", "lockedUntil");

CREATE INDEX "ReservationEmailOutbox_createdAt_idx"
ON "ReservationEmailOutbox"("createdAt");

ALTER TABLE "ReservationEmailOutbox"
ADD CONSTRAINT "ReservationEmailOutbox_reservationId_fkey"
FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
