CREATE TYPE "PrivateBlockAuditResult" AS ENUM ('CREATED', 'NO_OP', 'RELEASED');

CREATE TYPE "PrivateBlockAuditSource" AS ENUM ('PUBLIC_FORM', 'ADMIN_SHARED_BASIC');

CREATE TABLE "PrivateBlockAuditLog" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT,
  "date" TEXT NOT NULL,
  "servicePeriod" "ServicePeriod" NOT NULL,
  "result" "PrivateBlockAuditResult" NOT NULL,
  "source" "PrivateBlockAuditSource" NOT NULL,
  "actorName" TEXT,
  "requestId" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrivateBlockAuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrivateBlockAuditLog_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "PrivateBlockAuditLog_date_servicePeriod_createdAt_idx"
ON "PrivateBlockAuditLog"("date", "servicePeriod", "createdAt");

CREATE INDEX "PrivateBlockAuditLog_reservationId_createdAt_idx"
ON "PrivateBlockAuditLog"("reservationId", "createdAt");

CREATE TABLE "ReservationRateLimitEvent" (
  "id" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "date" TEXT,
  "servicePeriod" "ServicePeriod",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReservationRateLimitEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReservationRateLimitEvent_keyHash_scope_createdAt_idx"
ON "ReservationRateLimitEvent"("keyHash", "scope", "createdAt");

CREATE INDEX "ReservationRateLimitEvent_date_servicePeriod_scope_createdAt_idx"
ON "ReservationRateLimitEvent"("date", "servicePeriod", "scope", "createdAt");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Reservation"
    WHERE "reservationType" = 'PRIVATE_BLOCK'::"ReservationType"
      AND "status" = 'CONFIRMED'::"ReservationStatus"
    GROUP BY "date", "servicePeriod"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot create partial unique index: duplicate active PRIVATE_BLOCK rows exist for the same date/servicePeriod';
  END IF;
END
$$;

CREATE UNIQUE INDEX "Reservation_active_private_block_unique_idx"
ON "Reservation"("date", "servicePeriod")
WHERE "reservationType" = 'PRIVATE_BLOCK'::"ReservationType"
  AND "status" = 'CONFIRMED'::"ReservationStatus";
