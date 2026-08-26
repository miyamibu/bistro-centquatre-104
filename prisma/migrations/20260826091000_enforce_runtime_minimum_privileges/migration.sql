-- Runtime application traffic never hard-deletes protected business or audit
-- evidence. Keep those capabilities with the migration owner only.
DO $minimum_runtime_privileges$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bistro_app_runtime') THEN
    REVOKE DELETE, TRUNCATE
    ON TABLE
      "Reservation",
      "BusinessDay",
      "BusinessDayAuditLog",
      "ReservationCorrectionAuditLog",
      "PrivateBlockAuditLog",
      "ReservationStatusAuditLog",
      "ReservationEmailOutbox",
      "ReservationIdempotency",
      "ReservationLineLinkToken",
      "ReservationManagementToken",
      "NotificationEvent",
      "LineWebhookInbox",
      "ReservationRateLimitEvent",
      "LineFriend",
      "LineCustomerLink",
      "DailyJournalEntry",
      "SchedulerHeartbeat",
      "OutboxDrainAuditLog"
    FROM bistro_app_runtime;
  END IF;
END
$minimum_runtime_privileges$;
