-- Add LINE reminder bookkeeping columns to Reservation
ALTER TABLE "Reservation" ADD COLUMN "lineReminderSentAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "lineReminderStatus" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "lineReminderError" TEXT;

CREATE INDEX "Reservation_lineReminderSentAt_idx" ON "Reservation" ("lineReminderSentAt");
