-- Customer-facing reservation management bearer tokens.
-- Only the SHA-256 digest is stored; the raw token is returned once at creation.

CREATE TABLE IF NOT EXISTS "ReservationManagementToken" (
    "id"            TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "tokenHash"     TEXT NOT NULL,
    "expiresAt"     TIMESTAMP(3) NOT NULL,
    "revokedAt"     TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationManagementToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReservationManagementToken_tokenHash_key"
    ON "ReservationManagementToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "ReservationManagementToken_reservationId_idx"
    ON "ReservationManagementToken"("reservationId");

CREATE INDEX IF NOT EXISTS "ReservationManagementToken_expiresAt_idx"
    ON "ReservationManagementToken"("expiresAt");

ALTER TABLE "ReservationManagementToken"
    DROP CONSTRAINT IF EXISTS "ReservationManagementToken_reservationId_fkey";
ALTER TABLE "ReservationManagementToken"
    ADD CONSTRAINT "ReservationManagementToken_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The public Data API must not expose bearer tokens. The server uses the
-- direct Prisma connection for all reads and writes.
ALTER TABLE "ReservationManagementToken" ENABLE ROW LEVEL SECURITY;
