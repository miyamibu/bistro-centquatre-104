-- The application connects with a dedicated non-owner runtime role. Table
-- grants do not bypass RLS, so mirror the documented least-privilege command
-- matrix with role-specific policies. Never create DELETE or ALL policies.
DO $runtime_business_policies$
DECLARE
  runtime_role text;
  requirement record;
  command_name text;
  policy_name text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['bistro_app_runtime', 'bistro_preview_runtime']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
      CONTINUE;
    END IF;

    FOR requirement IN
      SELECT *
      FROM (VALUES
        ('Reservation', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('BusinessDay', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('BusinessDayAuditLog', ARRAY['SELECT', 'INSERT']::text[]),
        ('ReservationCorrectionAuditLog', ARRAY['SELECT', 'INSERT']::text[]),
        ('PrivateBlockAuditLog', ARRAY['SELECT', 'INSERT']::text[]),
        ('ReservationStatusAuditLog', ARRAY['SELECT', 'INSERT']::text[]),
        ('ReservationEmailOutbox', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('ReservationIdempotency', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('ReservationLineLinkToken', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('ReservationManagementToken', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('NotificationEvent', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('LineWebhookInbox', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('ReservationRateLimitEvent', ARRAY['SELECT', 'INSERT']::text[]),
        ('LineFriend', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('LineCustomerLink', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('DailyJournalEntry', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('SchedulerHeartbeat', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('OutboxDrainAuditLog', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[])
      ) AS required(table_name, commands)
    LOOP
      IF to_regclass(format('public.%I', requirement.table_name)) IS NULL THEN
        RAISE EXCEPTION 'Required runtime table is missing: %', requirement.table_name;
      END IF;

      FOREACH command_name IN ARRAY requirement.commands
      LOOP
        policy_name := lower(runtime_role || '_' || requirement.table_name || '_' || command_name);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, requirement.table_name);

        CASE command_name
          WHEN 'select' THEN
            EXECUTE format(
              'CREATE POLICY %I ON public.%I FOR SELECT TO %I USING (true)',
              policy_name,
              requirement.table_name,
              runtime_role
            );
          WHEN 'insert' THEN
            EXECUTE format(
              'CREATE POLICY %I ON public.%I FOR INSERT TO %I WITH CHECK (true)',
              policy_name,
              requirement.table_name,
              runtime_role
            );
          WHEN 'update' THEN
            EXECUTE format(
              'CREATE POLICY %I ON public.%I FOR UPDATE TO %I USING (true) WITH CHECK (true)',
              policy_name,
              requirement.table_name,
              runtime_role
            );
          ELSE
            RAISE EXCEPTION 'Unsupported runtime policy command: %', command_name;
        END CASE;
      END LOOP;
    END LOOP;
  END LOOP;
END
$runtime_business_policies$;
