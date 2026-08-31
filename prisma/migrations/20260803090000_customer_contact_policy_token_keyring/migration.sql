-- Customer recovery delivery, cancellation policy snapshots, and token key rotation metadata.
CREATE TYPE "ReservationContactChannel" AS ENUM ('EMAIL', 'LINE');

ALTER TYPE "ReservationEmailNotificationType" ADD VALUE IF NOT EXISTS 'CUSTOMER_CONFIRMATION';

ALTER TABLE "Reservation"
  ADD COLUMN "customerEmail" TEXT,
  ADD COLUMN "customerEmailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "contactChannel" "ReservationContactChannel",
  ADD COLUMN "cancellationPolicyVersion" TEXT,
  ADD COLUMN "cancellationPolicyAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelSource" TEXT,
  ADD COLUMN "cancellationReason" TEXT;

ALTER TABLE "ReservationIdempotency"
  ADD COLUMN "tokenKeyId" TEXT;

ALTER TABLE "ReservationLineLinkToken"
  ADD COLUMN "keyId" TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE "ReservationManagementToken"
  ADD COLUMN "keyId" TEXT NOT NULL DEFAULT 'v1';
