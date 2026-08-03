-- Durable idempotency records for public reservation creation.
-- The reservation, response, and idempotency claim are committed together.

CREATE TABLE "ReservationIdempotency" (
    "idempotencyKey" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "reservationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationIdempotency_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ReservationIdempotency" ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX "ReservationIdempotency_idempotencyKey_key"
ON "ReservationIdempotency"("idempotencyKey");

CREATE INDEX "ReservationIdempotency_reservationId_idx"
ON "ReservationIdempotency"("reservationId");

CREATE INDEX "ReservationIdempotency_createdAt_idx"
ON "ReservationIdempotency"("createdAt");

ALTER TABLE "ReservationIdempotency"
ADD CONSTRAINT "ReservationIdempotency_reservationId_fkey"
FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
