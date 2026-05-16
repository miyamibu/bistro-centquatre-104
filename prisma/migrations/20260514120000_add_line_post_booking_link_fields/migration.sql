-- Add fields supporting post-booking LINE linking flow.
-- Additive only: ADD COLUMN ... NULL, no DEFAULT, no NOT NULL, no destructive change.
ALTER TABLE "Reservation" ADD COLUMN "lineClaimTokenHash" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "lineClaimExpiresAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "lineConfirmationSentAt" TIMESTAMP(3);
