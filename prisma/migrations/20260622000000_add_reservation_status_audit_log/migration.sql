CREATE TABLE "ReservationStatusAuditLog" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "actorName" TEXT,
    "requestId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "previousStatus" "ReservationStatus" NOT NULL,
    "nextStatus" "ReservationStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationStatusAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReservationStatusAuditLog_reservationId_createdAt_idx"
ON "ReservationStatusAuditLog"("reservationId", "createdAt");

CREATE INDEX "ReservationStatusAuditLog_createdAt_idx"
ON "ReservationStatusAuditLog"("createdAt");

ALTER TABLE "ReservationStatusAuditLog"
ADD CONSTRAINT "ReservationStatusAuditLog_reservationId_fkey"
FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
