-- Preserve reservation audit, LINE-link, and notification evidence if a direct
-- reservation delete is attempted. The application uses status transitions.

ALTER TABLE "ReservationStatusAuditLog"
    DROP CONSTRAINT IF EXISTS "ReservationStatusAuditLog_reservationId_fkey";
ALTER TABLE "ReservationStatusAuditLog"
    ADD CONSTRAINT "ReservationStatusAuditLog_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReservationLineLinkToken"
    DROP CONSTRAINT IF EXISTS "ReservationLineLinkToken_reservationId_fkey";
ALTER TABLE "ReservationLineLinkToken"
    ADD CONSTRAINT "ReservationLineLinkToken_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationEvent"
    DROP CONSTRAINT IF EXISTS "NotificationEvent_reservationId_fkey";
ALTER TABLE "NotificationEvent"
    ADD CONSTRAINT "NotificationEvent_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep the Prisma-managed evidence tables fail-closed even when the separately
-- managed Supabase policy file has not yet been applied.
ALTER TABLE "ReservationStatusAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReservationLineLinkToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationEvent" ENABLE ROW LEVEL SECURITY;
