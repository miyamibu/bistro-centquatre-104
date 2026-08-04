ALTER TYPE "ReservationEmailNotificationType" ADD VALUE IF NOT EXISTS 'RESERVATION_CANCELLED_CUSTOMER';
ALTER TYPE "ReservationEmailNotificationType" ADD VALUE IF NOT EXISTS 'RESERVATION_NOSHOW_CUSTOMER';

ALTER TABLE "ReservationStatusAuditLog"
  ADD COLUMN "actorUserId" TEXT,
  ADD COLUMN "actorEmail" TEXT,
  ADD COLUMN "actorRole" TEXT,
  ADD COLUMN "operatorLabel" TEXT;

ALTER TABLE "PrivateBlockAuditLog"
  ADD COLUMN "actorUserId" TEXT,
  ADD COLUMN "actorEmail" TEXT,
  ADD COLUMN "actorRole" TEXT,
  ADD COLUMN "operatorLabel" TEXT;

CREATE TABLE "BusinessDayAuditLog" (
  "id" TEXT NOT NULL,
  "businessDayId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "previousIsClosed" BOOLEAN,
  "nextIsClosed" BOOLEAN NOT NULL,
  "previousNote" TEXT,
  "nextNote" TEXT,
  "actorName" TEXT,
  "actorUserId" TEXT,
  "actorEmail" TEXT,
  "actorRole" TEXT,
  "requestId" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BusinessDayAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessDayAuditLog_date_createdAt_idx"
  ON "BusinessDayAuditLog"("date", "createdAt");
CREATE INDEX "BusinessDayAuditLog_businessDayId_createdAt_idx"
  ON "BusinessDayAuditLog"("businessDayId", "createdAt");

ALTER TABLE "BusinessDayAuditLog"
  ADD CONSTRAINT "BusinessDayAuditLog_businessDayId_fkey"
  FOREIGN KEY ("businessDayId") REFERENCES "BusinessDay"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReservationCorrectionAuditLog" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "actorName" TEXT,
  "actorUserId" TEXT,
  "actorEmail" TEXT,
  "actorRole" TEXT,
  "requestId" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "reason" TEXT NOT NULL,
  "beforeData" JSONB NOT NULL,
  "afterData" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReservationCorrectionAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReservationCorrectionAuditLog_reservationId_createdAt_idx"
  ON "ReservationCorrectionAuditLog"("reservationId", "createdAt");
CREATE INDEX "ReservationCorrectionAuditLog_createdAt_idx"
  ON "ReservationCorrectionAuditLog"("createdAt");

ALTER TABLE "ReservationCorrectionAuditLog"
  ADD CONSTRAINT "ReservationCorrectionAuditLog_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep newly added operational evidence fail-closed even before the separately
-- managed Supabase policy file is applied.
ALTER TABLE "BusinessDayAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReservationCorrectionAuditLog" ENABLE ROW LEVEL SECURITY;
