-- Read-only release assertions for the bistro database.
-- Run with psql -v ON_ERROR_STOP=1 so every RAISE EXCEPTION becomes a non-zero exit.
-- Optional: SET bistro.verify_runtime_role = 'bistro_app_runtime';
-- When explicitly set, a missing role is a FAIL. Without that setting, the
-- default role is checked when present and otherwise reported as SKIP.

DO $verify_required_tables$
DECLARE
  missing_tables text[];
BEGIN
  SELECT array_agg(required.table_name ORDER BY required.table_name)
  INTO missing_tables
  FROM unnest(ARRAY[
    'orders',
    'order_history',
    'bank_account',
    'order_actions',
    'human_tokens',
    'order_receipt_tokens',
    'api_idempotency',
    'contact_rate_limit_buckets',
    'order_notification_outbox',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationIdempotency',
    'ReservationLineLinkToken',
    'ReservationManagementToken',
    'NotificationEvent',
    'LineWebhookInbox',
    'ReservationRateLimitEvent',
    'BusinessDay',
    'BusinessDayAuditLog',
    'ReservationCorrectionAuditLog',
    'MenuItem',
    'Photo',
    'LineFriend',
    'LineCustomerLink',
    'DailyJournalEntry',
    'SchedulerHeartbeat',
    'OutboxDrainAuditLog'
  ]::text[]) AS required(table_name)
  WHERE to_regclass(format('%I.%I', 'public', required.table_name)) IS NULL;

  IF coalesce(cardinality(missing_tables), 0) > 0 THEN
    RAISE EXCEPTION 'FAIL required tables missing: %', array_to_string(missing_tables, ', ');
  END IF;
END
$verify_required_tables$;

DO $verify_rls$
DECLARE
  rls_disabled_tables text[];
BEGIN
  SELECT array_agg(required.table_name ORDER BY required.table_name)
  INTO rls_disabled_tables
  FROM unnest(ARRAY[
    'orders',
    'order_history',
    'bank_account',
    'order_actions',
    'human_tokens',
    'order_receipt_tokens',
    'api_idempotency',
    'contact_rate_limit_buckets',
    'order_notification_outbox',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationIdempotency',
    'ReservationLineLinkToken',
    'ReservationManagementToken',
    'NotificationEvent',
    'LineWebhookInbox',
    'ReservationRateLimitEvent',
    'BusinessDay',
    'BusinessDayAuditLog',
    'ReservationCorrectionAuditLog',
    'MenuItem',
    'Photo',
    'LineFriend',
    'LineCustomerLink',
    'DailyJournalEntry',
    'SchedulerHeartbeat',
    'OutboxDrainAuditLog'
  ]::text[]) AS required(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class table_class
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
    WHERE table_namespace.nspname = 'public'
      AND table_class.relname = required.table_name
      AND table_class.relkind IN ('r', 'p')
      AND table_class.relrowsecurity
  );

  IF coalesce(cardinality(rls_disabled_tables), 0) > 0 THEN
    RAISE EXCEPTION 'FAIL RLS disabled: %', array_to_string(rls_disabled_tables, ', ');
  END IF;
END
$verify_rls$;

DO $verify_policies$
DECLARE
  missing_or_invalid_policies text[];
  unsafe_data_api_policies text[];
BEGIN
  WITH policy_targets(table_name, policy_prefix) AS (
    VALUES
      ('orders', 'orders'),
      ('order_history', 'order_history'),
      ('bank_account', 'bank_account'),
      ('order_actions', 'order_actions'),
      ('human_tokens', 'human_tokens'),
      ('order_receipt_tokens', 'order_receipt_tokens'),
      ('api_idempotency', 'api_idempotency'),
      ('contact_rate_limit_buckets', 'contact_rate_limit_buckets'),
      ('order_notification_outbox', 'order_notification_outbox'),
      ('bank_account_history', 'bank_account_history'),
      ('Reservation', 'reservation'),
      ('PrivateBlockAuditLog', 'private_block_audit'),
      ('ReservationStatusAuditLog', 'reservation_status_audit'),
      ('ReservationEmailOutbox', 'reservation_email_outbox'),
      ('ReservationIdempotency', 'reservation_idempotency'),
      ('ReservationLineLinkToken', 'reservation_line_link_token'),
      ('ReservationManagementToken', 'reservation_management_token'),
      ('NotificationEvent', 'notification_event'),
      ('LineWebhookInbox', 'line_webhook_inbox'),
      ('ReservationRateLimitEvent', 'reservation_rate_limit'),
      ('BusinessDay', 'business_day'),
      ('BusinessDayAuditLog', 'business_day_audit'),
      ('ReservationCorrectionAuditLog', 'reservation_correction_audit'),
      ('MenuItem', 'menu_item'),
      ('Photo', 'photo'),
      ('LineFriend', 'line_friend'),
      ('LineCustomerLink', 'line_customer_link'),
      ('DailyJournalEntry', 'daily_journal_entry'),
      ('SchedulerHeartbeat', 'scheduler_heartbeat'),
      ('OutboxDrainAuditLog', 'outbox_drain_audit')
  ),
  expected_rules(policy_suffix, role_name, expected_expression) AS (
    VALUES
      ('_deny_anon_all', 'anon', 'false'),
      ('_deny_authenticated_all', 'authenticated', 'false'),
      ('_service_role_all', 'service_role', 'true')
  ),
  expected_policies AS (
    SELECT
      target.table_name,
      target.policy_prefix || rule.policy_suffix AS policy_name,
      rule.role_name,
      rule.expected_expression
    FROM policy_targets target
    CROSS JOIN expected_rules rule
  )
  SELECT array_agg(
    format('%s.%s', expected.table_name, expected.policy_name)
    ORDER BY expected.table_name, expected.policy_name
  )
  INTO missing_or_invalid_policies
  FROM expected_policies expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = expected.table_name
      AND policy.policyname = expected.policy_name
      AND policy.cmd = 'ALL'
      AND policy.permissive = 'PERMISSIVE'
      AND expected.role_name::name = ANY(policy.roles)
      AND regexp_replace(coalesce(policy.qual, ''), '[()[:space:]]', '', 'g') = expected.expected_expression
      AND regexp_replace(coalesce(policy.with_check, ''), '[()[:space:]]', '', 'g') = expected.expected_expression
  );

  IF coalesce(cardinality(missing_or_invalid_policies), 0) > 0 THEN
    RAISE EXCEPTION 'FAIL required RLS policies missing or invalid: %',
      array_to_string(missing_or_invalid_policies, ', ');
  END IF;

  -- These Prisma-only operational tables intentionally use RLS default-deny
  -- when no Data API policy is installed. Explicit deny policies remain valid;
  -- any policy that can expose rows to public/anon/authenticated is a FAIL.
  WITH protected_tables(table_name) AS (
    VALUES
      ('ReservationIdempotency'),
      ('ReservationLineLinkToken'),
      ('ReservationManagementToken'),
      ('NotificationEvent'),
      ('LineWebhookInbox'),
      ('LineFriend'),
      ('LineCustomerLink'),
      ('DailyJournalEntry'),
      ('SchedulerHeartbeat'),
      ('OutboxDrainAuditLog')
  ),
  normalized_policies AS (
    SELECT
      policy.tablename,
      policy.policyname,
      policy.cmd,
      policy.roles,
      regexp_replace(coalesce(policy.qual, ''), '[()[:space:]]', '', 'g') AS using_expression,
      regexp_replace(coalesce(policy.with_check, ''), '[()[:space:]]', '', 'g') AS check_expression
    FROM pg_policies policy
    JOIN protected_tables protected ON protected.table_name = policy.tablename
    WHERE policy.schemaname = 'public'
  )
  SELECT array_agg(
    format('%s.%s', policy.tablename, policy.policyname)
    ORDER BY policy.tablename, policy.policyname
  )
  INTO unsafe_data_api_policies
  FROM normalized_policies policy
  WHERE (
      'public'::name = ANY(policy.roles)
      OR 'anon'::name = ANY(policy.roles)
      OR 'authenticated'::name = ANY(policy.roles)
    )
    AND (
      (
        policy.cmd IN ('ALL', 'SELECT', 'UPDATE', 'DELETE')
        AND policy.using_expression IS DISTINCT FROM 'false'
      )
      OR (
        policy.cmd IN ('ALL', 'INSERT', 'UPDATE')
        AND policy.check_expression IS DISTINCT FROM 'false'
      )
    );

  IF coalesce(cardinality(unsafe_data_api_policies), 0) > 0 THEN
    RAISE EXCEPTION 'FAIL unsafe Data API policies found: %',
      array_to_string(unsafe_data_api_policies, ', ');
  END IF;
END
$verify_policies$;

DO $verify_reservation_foreign_keys$
DECLARE
  missing_or_invalid_foreign_keys text[];
BEGIN
  WITH expected_foreign_keys(table_name, constraint_name) AS (
    VALUES
      ('ReservationStatusAuditLog', 'ReservationStatusAuditLog_reservationId_fkey'),
      ('ReservationLineLinkToken', 'ReservationLineLinkToken_reservationId_fkey'),
      ('ReservationManagementToken', 'ReservationManagementToken_reservationId_fkey'),
      ('NotificationEvent', 'NotificationEvent_reservationId_fkey'),
      ('ReservationEmailOutbox', 'ReservationEmailOutbox_reservationId_fkey'),
      ('ReservationIdempotency', 'ReservationIdempotency_reservationId_fkey')
  )
  SELECT array_agg(expected.constraint_name ORDER BY expected.constraint_name)
  INTO missing_or_invalid_foreign_keys
  FROM expected_foreign_keys expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_record
    WHERE constraint_record.contype = 'f'
      AND constraint_record.conname = expected.constraint_name
      AND constraint_record.conrelid = to_regclass(format('%I.%I', 'public', expected.table_name))
      AND constraint_record.confrelid = to_regclass(format('%I.%I', 'public', 'Reservation'))
      AND constraint_record.confdeltype = 'r'
      AND constraint_record.confupdtype = 'c'
  );

  IF coalesce(cardinality(missing_or_invalid_foreign_keys), 0) > 0 THEN
    RAISE EXCEPTION 'FAIL reservation FKs missing or not ON DELETE RESTRICT / ON UPDATE CASCADE: %',
      array_to_string(missing_or_invalid_foreign_keys, ', ');
  END IF;
END
$verify_reservation_foreign_keys$;

DO $verify_operational_audit_foreign_keys$
DECLARE
  missing_or_invalid_foreign_keys text[];
BEGIN
  WITH expected_foreign_keys(table_name, constraint_name, parent_table) AS (
    VALUES
      ('BusinessDayAuditLog', 'BusinessDayAuditLog_businessDayId_fkey', 'BusinessDay'),
      ('ReservationCorrectionAuditLog', 'ReservationCorrectionAuditLog_reservationId_fkey', 'Reservation')
  )
  SELECT array_agg(expected.constraint_name ORDER BY expected.constraint_name)
  INTO missing_or_invalid_foreign_keys
  FROM expected_foreign_keys expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_record
    WHERE constraint_record.contype = 'f'
      AND constraint_record.conname = expected.constraint_name
      AND constraint_record.conrelid = to_regclass(format('%I.%I', 'public', expected.table_name))
      AND constraint_record.confrelid = to_regclass(format('%I.%I', 'public', expected.parent_table))
      AND constraint_record.confdeltype = 'r'
      AND constraint_record.confupdtype = 'c'
  );

  IF coalesce(cardinality(missing_or_invalid_foreign_keys), 0) > 0 THEN
    RAISE EXCEPTION 'FAIL operational audit FKs missing or not ON DELETE RESTRICT / ON UPDATE CASCADE: %',
      array_to_string(missing_or_invalid_foreign_keys, ', ');
  END IF;
END
$verify_operational_audit_foreign_keys$;

DO $verify_runtime_role$
DECLARE
  configured_runtime_role text := nullif(current_setting('bistro.verify_runtime_role', true), '');
  runtime_role text;
  missing_grants text[];
  forbidden_grants text[];
  forbidden_delete_policies text[];
  missing_runtime_policies text[];
  runtime_role_is_superuser boolean;
  runtime_role_bypasses_rls boolean;
  runtime_owned_tables text[];
BEGIN
  IF configured_runtime_role IS NOT NULL THEN
    SELECT role_record.rolname::text
    INTO runtime_role
    FROM pg_roles role_record
    WHERE role_record.rolname = configured_runtime_role;

    IF runtime_role IS NULL THEN
      RAISE EXCEPTION 'FAIL configured runtime role does not exist: %', configured_runtime_role;
    END IF;
  ELSE
    SELECT role_record.rolname::text
    INTO runtime_role
    FROM pg_roles role_record
    WHERE role_record.rolname = 'bistro_app_runtime';
  END IF;

  IF runtime_role IS NULL THEN
    RAISE NOTICE 'SKIP runtime role grants: optional role bistro_app_runtime does not exist';
  ELSE
    SELECT role_record.rolsuper, role_record.rolbypassrls
    INTO runtime_role_is_superuser, runtime_role_bypasses_rls
    FROM pg_roles role_record
    WHERE role_record.rolname = runtime_role;

    IF runtime_role_is_superuser OR runtime_role_bypasses_rls THEN
      RAISE EXCEPTION 'FAIL runtime role % can bypass RLS (superuser=%, bypassrls=%)',
        runtime_role,
        runtime_role_is_superuser,
        runtime_role_bypasses_rls;
    END IF;

    SELECT array_agg(table_class.relname ORDER BY table_class.relname)
    INTO runtime_owned_tables
    FROM pg_class table_class
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
    JOIN pg_roles owner_role ON owner_role.oid = table_class.relowner
    WHERE table_namespace.nspname = 'public'
      AND table_class.relkind IN ('r', 'p')
      AND owner_role.rolname = runtime_role
      AND table_class.relname IN (
        'orders',
        'order_history',
        'order_actions',
        'human_tokens',
        'order_receipt_tokens',
        'api_idempotency',
        'order_notification_outbox',
        'Reservation',
        'ReservationEmailOutbox',
        'ReservationIdempotency'
      );

    IF coalesce(cardinality(runtime_owned_tables), 0) > 0 THEN
      RAISE EXCEPTION 'FAIL runtime role % owns RLS-protected tables and can bypass owner RLS: %',
        runtime_role,
        array_to_string(runtime_owned_tables, ', ');
    END IF;

    WITH privilege_requirements(table_name, privileges) AS (
      VALUES
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
    ),
    expanded_requirements AS (
      SELECT requirement.table_name, privilege_row.privilege_name
      FROM privilege_requirements requirement
      CROSS JOIN LATERAL unnest(requirement.privileges) AS privilege_row(privilege_name)
    )
    SELECT array_agg(
      format('%s:%s', requirement.table_name, requirement.privilege_name)
      ORDER BY requirement.table_name, requirement.privilege_name
    )
    INTO missing_grants
    FROM expanded_requirements requirement
    WHERE NOT has_table_privilege(
      runtime_role,
      to_regclass(format('%I.%I', 'public', requirement.table_name)),
      requirement.privilege_name
    );

    IF coalesce(cardinality(missing_grants), 0) > 0 THEN
      RAISE EXCEPTION 'FAIL runtime role % missing required privileges: %',
        runtime_role,
        array_to_string(missing_grants, ', ');
    END IF;

    WITH protected_tables(table_name) AS (
      VALUES
        ('Reservation'),
        ('BusinessDay'),
        ('BusinessDayAuditLog'),
        ('ReservationCorrectionAuditLog'),
        ('PrivateBlockAuditLog'),
        ('ReservationStatusAuditLog'),
        ('ReservationEmailOutbox'),
        ('ReservationIdempotency'),
        ('ReservationLineLinkToken'),
        ('ReservationManagementToken'),
        ('NotificationEvent'),
        ('LineWebhookInbox'),
        ('ReservationRateLimitEvent'),
        ('LineFriend'),
        ('LineCustomerLink'),
        ('DailyJournalEntry'),
        ('SchedulerHeartbeat'),
        ('OutboxDrainAuditLog')
    ),
    forbidden_privileges(privilege_name) AS (
      VALUES ('DELETE'), ('TRUNCATE')
    )
    SELECT array_agg(
      format('%s:%s', protected.table_name, forbidden.privilege_name)
      ORDER BY protected.table_name, forbidden.privilege_name
    )
    INTO forbidden_grants
    FROM protected_tables protected
    CROSS JOIN forbidden_privileges forbidden
    WHERE has_table_privilege(
      runtime_role,
      to_regclass(format('%I.%I', 'public', protected.table_name)),
      forbidden.privilege_name
    );

    IF coalesce(cardinality(forbidden_grants), 0) > 0 THEN
      RAISE EXCEPTION 'FAIL runtime role % has forbidden privileges: %',
        runtime_role,
        array_to_string(forbidden_grants, ', ');
    END IF;

    SELECT array_agg(
      format('%s.%s', policy.tablename, policy.policyname)
      ORDER BY policy.tablename, policy.policyname
    )
    INTO forbidden_delete_policies
    FROM pg_policies policy
    WHERE policy.schemaname = 'public'
      AND runtime_role::name = ANY(policy.roles)
      AND policy.cmd IN ('DELETE', 'ALL')
      AND policy.tablename = ANY(ARRAY[
        'Reservation',
        'BusinessDay',
        'BusinessDayAuditLog',
        'ReservationCorrectionAuditLog',
        'PrivateBlockAuditLog',
        'ReservationStatusAuditLog',
        'ReservationEmailOutbox',
        'ReservationIdempotency',
        'ReservationLineLinkToken',
        'ReservationManagementToken',
        'NotificationEvent',
        'LineWebhookInbox',
        'ReservationRateLimitEvent',
        'LineFriend',
        'LineCustomerLink',
        'DailyJournalEntry',
        'SchedulerHeartbeat',
        'OutboxDrainAuditLog'
      ]::text[]);

    IF coalesce(cardinality(forbidden_delete_policies), 0) > 0 THEN
      RAISE EXCEPTION 'FAIL runtime role % has forbidden DELETE policies: %',
        runtime_role,
        array_to_string(forbidden_delete_policies, ', ');
    END IF;

    WITH required_policy(table_name, command_name) AS (
      VALUES
        ('Reservation', 'SELECT'),
        ('Reservation', 'INSERT'),
        ('Reservation', 'UPDATE'),
        ('BusinessDay', 'SELECT'),
        ('BusinessDay', 'INSERT'),
        ('BusinessDay', 'UPDATE'),
        ('BusinessDayAuditLog', 'SELECT'),
        ('BusinessDayAuditLog', 'INSERT'),
        ('ReservationCorrectionAuditLog', 'SELECT'),
        ('ReservationCorrectionAuditLog', 'INSERT'),
        ('PrivateBlockAuditLog', 'SELECT'),
        ('PrivateBlockAuditLog', 'INSERT'),
        ('ReservationStatusAuditLog', 'SELECT'),
        ('ReservationStatusAuditLog', 'INSERT'),
        ('ReservationEmailOutbox', 'SELECT'),
        ('ReservationEmailOutbox', 'INSERT'),
        ('ReservationEmailOutbox', 'UPDATE'),
        ('ReservationIdempotency', 'SELECT'),
        ('ReservationIdempotency', 'INSERT'),
        ('ReservationIdempotency', 'UPDATE'),
        ('ReservationLineLinkToken', 'SELECT'),
        ('ReservationLineLinkToken', 'INSERT'),
        ('ReservationLineLinkToken', 'UPDATE'),
        ('ReservationManagementToken', 'SELECT'),
        ('ReservationManagementToken', 'INSERT'),
        ('ReservationManagementToken', 'UPDATE'),
        ('NotificationEvent', 'SELECT'),
        ('NotificationEvent', 'INSERT'),
        ('NotificationEvent', 'UPDATE'),
        ('LineWebhookInbox', 'SELECT'),
        ('LineWebhookInbox', 'INSERT'),
        ('LineWebhookInbox', 'UPDATE'),
        ('ReservationRateLimitEvent', 'SELECT'),
        ('ReservationRateLimitEvent', 'INSERT'),
        ('LineFriend', 'SELECT'),
        ('LineFriend', 'INSERT'),
        ('LineFriend', 'UPDATE'),
        ('LineCustomerLink', 'SELECT'),
        ('LineCustomerLink', 'INSERT'),
        ('LineCustomerLink', 'UPDATE'),
        ('DailyJournalEntry', 'SELECT'),
        ('DailyJournalEntry', 'INSERT'),
        ('DailyJournalEntry', 'UPDATE'),
        ('SchedulerHeartbeat', 'SELECT'),
        ('SchedulerHeartbeat', 'INSERT'),
        ('SchedulerHeartbeat', 'UPDATE'),
        ('OutboxDrainAuditLog', 'SELECT'),
        ('OutboxDrainAuditLog', 'INSERT'),
        ('OutboxDrainAuditLog', 'UPDATE')
    )
    SELECT array_agg(
      format('%s:%s', required.table_name, required.command_name)
      ORDER BY required.table_name, required.command_name
    )
    INTO missing_runtime_policies
    FROM required_policy required
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policies policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = required.table_name
        AND policy.cmd = required.command_name
        AND runtime_role::name = ANY(policy.roles)
    );

    IF coalesce(cardinality(missing_runtime_policies), 0) > 0 THEN
      RAISE EXCEPTION 'FAIL runtime role % missing required RLS policies: %',
        runtime_role,
        array_to_string(missing_runtime_policies, ', ');
    END IF;

    RAISE NOTICE 'PASS runtime role grants: %', runtime_role;
  END IF;
END
$verify_runtime_role$;

DO $verify_order_idempotency_shape$
DECLARE
  missing_columns text[];
  has_unique_identity boolean;
  has_claim_index boolean;
BEGIN
  WITH expected_columns(column_name, udt_name) AS (
    VALUES
      ('claim_token', 'uuid'),
      ('claim_expires_at', 'timestamptz')
  )
  SELECT array_agg(format('%s:%s', expected.column_name, expected.udt_name))
  INTO missing_columns
  FROM expected_columns expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_record
    WHERE column_record.table_schema = 'public'
      AND column_record.table_name = 'api_idempotency'
      AND column_record.column_name = expected.column_name
      AND column_record.udt_name = expected.udt_name
  );

  IF coalesce(cardinality(missing_columns), 0) > 0 THEN
    RAISE EXCEPTION 'FAIL api_idempotency required columns missing or wrong type: %',
      array_to_string(missing_columns, ', ');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_record
    WHERE constraint_record.conrelid = 'public.api_idempotency'::regclass
      AND constraint_record.contype = 'u'
      AND (
        SELECT array_agg(attribute_record.attname ORDER BY key_record.ordinality)
        FROM unnest(constraint_record.conkey) WITH ORDINALITY key_record(attnum, ordinality)
        JOIN pg_attribute attribute_record
          ON attribute_record.attrelid = constraint_record.conrelid
         AND attribute_record.attnum = key_record.attnum
      ) = ARRAY['scope', 'actor_key', 'idempotency_key']::name[]
  ) INTO has_unique_identity;

  IF NOT has_unique_identity THEN
    RAISE EXCEPTION 'FAIL api_idempotency unique(scope, actor_key, idempotency_key) is missing';
  END IF;

  SELECT to_regclass('public.idx_api_idempotency_unfinalized_claim') IS NOT NULL
  INTO has_claim_index;
  IF NOT has_claim_index THEN
    RAISE EXCEPTION 'FAIL api_idempotency unfinished-claim index is missing';
  END IF;
END
$verify_order_idempotency_shape$;

DO $verify_order_rpc_security$
DECLARE
  expected_signatures text[] := ARRAY[
    'public.execute_atomic_order_mutation(text,text,text,text,text,jsonb,jsonb,integer)',
    'public.execute_terminal_order_action(text,text,text,text,uuid,integer,text,text,text,text,text,text)',
    'public.create_order_quote_with_receipt_action(text,text,text,text,text,text,text,text,jsonb,integer,timestamp with time zone,text,text,text,text,text,date,text)',
    'public.confirm_order_human_action(uuid,integer,text,text,text,text)',
    'public.set_order_payment_method_action(uuid,integer,text,date,timestamp with time zone,text,text,text,text,text)',
    'public.mark_order_paid_action(uuid,integer,text,integer,text,text,text,text,text)',
    'public.mark_order_collected_action(uuid,integer,integer,text,text,text,text,text)'
  ];
  signature text;
  procedure_oid regprocedure;
  procedure_record record;
BEGIN
  FOREACH signature IN ARRAY expected_signatures LOOP
    procedure_oid := to_regprocedure(signature);
    IF procedure_oid IS NULL THEN
      RAISE EXCEPTION 'FAIL required order RPC signature missing: %', signature;
    END IF;

    SELECT procedure.prosecdef, procedure.proconfig
    INTO procedure_record
    FROM pg_proc procedure
    WHERE procedure.oid = procedure_oid;

    IF procedure_record.prosecdef THEN
      RAISE EXCEPTION 'FAIL order RPC must be SECURITY INVOKER: %', signature;
    END IF;

    IF EXISTS (
         SELECT 1
         FROM pg_proc acl_procedure
         CROSS JOIN LATERAL aclexplode(
           coalesce(acl_procedure.proacl, acldefault('f', acl_procedure.proowner))
         ) acl
         WHERE acl_procedure.oid = procedure_oid
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       )
       OR has_function_privilege('anon', procedure_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', procedure_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL order RPC is exposed outside service_role: %', signature;
    END IF;

    IF NOT has_function_privilege('service_role', procedure_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL service_role cannot execute order RPC: %', signature;
    END IF;
  END LOOP;

  procedure_oid := to_regprocedure(
    'public.execute_atomic_order_mutation(text,text,text,text,text,jsonb,jsonb,integer)'
  );
  SELECT procedure.proconfig
  INTO procedure_record
  FROM pg_proc procedure
  WHERE procedure.oid = procedure_oid;
  IF coalesce(array_to_string(procedure_record.proconfig, ', '), '') NOT LIKE '%search_path=pg_catalog, public%' THEN
    RAISE EXCEPTION 'FAIL atomic order RPC search_path is not pinned';
  END IF;
END
$verify_order_rpc_security$;

DO $verify_expired_line_link_cleanup$
DECLARE
  configured_runtime_role text := nullif(current_setting('bistro.verify_runtime_role', true), '');
  runtime_role text;
  cleanup_function regprocedure := to_regprocedure(
    'public.cleanup_expired_reservation_line_link_tokens(timestamp with time zone,integer)'
  );
  exposed_roles text[];
  public_execute boolean;
BEGIN
  IF cleanup_function IS NULL THEN
    RAISE EXCEPTION 'FAIL expired reservation LINE link token cleanup function is missing';
  END IF;

  IF configured_runtime_role IS NOT NULL THEN
    SELECT rolname::text INTO runtime_role FROM pg_roles WHERE rolname = configured_runtime_role;
  ELSE
    SELECT rolname::text INTO runtime_role FROM pg_roles WHERE rolname = 'bistro_app_runtime';
  END IF;

  IF runtime_role IS NOT NULL
     AND NOT has_function_privilege(runtime_role, cleanup_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL runtime role % cannot execute expired LINE link cleanup', runtime_role;
  END IF;

  SELECT array_agg(role_record.rolname::text ORDER BY role_record.rolname)
  INTO exposed_roles
  FROM pg_roles role_record
  WHERE role_record.rolname IN ('anon', 'authenticated', 'service_role')
    AND has_function_privilege(role_record.rolname, cleanup_function, 'EXECUTE');

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    CROSS JOIN LATERAL aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) acl
    WHERE procedure.oid = cleanup_function
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
  INTO public_execute;

  IF coalesce(cardinality(exposed_roles), 0) > 0 OR public_execute THEN
    RAISE EXCEPTION 'FAIL expired LINE link cleanup exposed to non-runtime roles: %',
      coalesce(array_to_string(exposed_roles, ', '), 'PUBLIC');
  END IF;

  RAISE NOTICE 'PASS expired reservation LINE link cleanup privilege boundary';
END
$verify_expired_line_link_cleanup$;

DO $verify_ephemeral_security_cleanup$
DECLARE
  configured_runtime_role text := nullif(current_setting('bistro.verify_runtime_role', true), '');
  runtime_role text;
  cleanup_function regprocedure := to_regprocedure(
    'public.cleanup_ephemeral_reservation_security_state(timestamp with time zone,timestamp with time zone,integer)'
  );
  exposed_roles text[];
  public_execute boolean;
BEGIN
  IF cleanup_function IS NULL THEN
    RAISE EXCEPTION 'FAIL ephemeral reservation security cleanup function is missing';
  END IF;

  IF configured_runtime_role IS NOT NULL THEN
    SELECT rolname::text INTO runtime_role FROM pg_roles WHERE rolname = configured_runtime_role;
  ELSE
    SELECT rolname::text INTO runtime_role FROM pg_roles WHERE rolname = 'bistro_app_runtime';
  END IF;

  IF runtime_role IS NOT NULL
     AND NOT has_function_privilege(runtime_role, cleanup_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL runtime role % cannot execute ephemeral security cleanup', runtime_role;
  END IF;

  SELECT array_agg(role_record.rolname::text ORDER BY role_record.rolname)
  INTO exposed_roles
  FROM pg_roles role_record
  WHERE role_record.rolname IN ('anon', 'authenticated', 'service_role')
    AND has_function_privilege(role_record.rolname, cleanup_function, 'EXECUTE');

  SELECT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    CROSS JOIN LATERAL aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) acl
    WHERE procedure.oid = cleanup_function
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
  INTO public_execute;

  IF coalesce(cardinality(exposed_roles), 0) > 0 OR public_execute THEN
    RAISE EXCEPTION 'FAIL ephemeral security cleanup exposed to non-runtime roles: %',
      coalesce(array_to_string(exposed_roles, ', '), 'PUBLIC');
  END IF;

  RAISE NOTICE 'PASS ephemeral reservation security cleanup privilege boundary';
END
$verify_ephemeral_security_cleanup$;

-- Human-readable evidence follows only after all required assertions pass.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'orders',
    'order_history',
    'bank_account',
    'order_actions',
    'human_tokens',
    'order_receipt_tokens',
    'api_idempotency',
    'contact_rate_limit_buckets',
    'order_notification_outbox',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationIdempotency',
    'ReservationLineLinkToken',
    'ReservationManagementToken',
    'NotificationEvent',
    'LineWebhookInbox',
    'ReservationRateLimitEvent',
    'BusinessDay',
    'BusinessDayAuditLog',
    'ReservationCorrectionAuditLog',
    'MenuItem',
    'Photo',
    'LineFriend',
    'LineCustomerLink',
    'DailyJournalEntry',
    'SchedulerHeartbeat',
    'OutboxDrainAuditLog'
  )
ORDER BY table_name;

SELECT
  table_class.relname AS table_name,
  table_class.relrowsecurity AS rls_enabled
FROM pg_class table_class
JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
WHERE table_namespace.nspname = 'public'
  AND table_class.relname IN (
    'orders',
    'order_history',
    'bank_account',
    'order_actions',
    'human_tokens',
    'order_receipt_tokens',
    'api_idempotency',
    'contact_rate_limit_buckets',
    'order_notification_outbox',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationIdempotency',
    'ReservationLineLinkToken',
    'ReservationManagementToken',
    'NotificationEvent',
    'LineWebhookInbox',
    'ReservationRateLimitEvent',
    'BusinessDay',
    'BusinessDayAuditLog',
    'ReservationCorrectionAuditLog',
    'MenuItem',
    'Photo',
    'LineFriend',
    'LineCustomerLink',
    'DailyJournalEntry',
    'SchedulerHeartbeat',
    'OutboxDrainAuditLog'
  )
ORDER BY table_class.relname;

SELECT tablename, policyname, cmd, permissive, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'orders',
    'order_history',
    'bank_account',
    'order_actions',
    'human_tokens',
    'order_receipt_tokens',
    'api_idempotency',
    'contact_rate_limit_buckets',
    'order_notification_outbox',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationIdempotency',
    'ReservationLineLinkToken',
    'ReservationManagementToken',
    'NotificationEvent',
    'LineWebhookInbox',
    'ReservationRateLimitEvent',
    'BusinessDay',
    'BusinessDayAuditLog',
    'ReservationCorrectionAuditLog',
    'MenuItem',
    'Photo',
    'LineFriend',
    'LineCustomerLink',
    'DailyJournalEntry',
    'SchedulerHeartbeat',
    'OutboxDrainAuditLog'
  )
ORDER BY tablename, policyname;

SELECT
  table_constraint.table_name,
  table_constraint.constraint_name,
  referential_constraint.update_rule,
  referential_constraint.delete_rule
FROM information_schema.table_constraints table_constraint
JOIN information_schema.referential_constraints referential_constraint
  ON referential_constraint.constraint_schema = table_constraint.constraint_schema
 AND referential_constraint.constraint_name = table_constraint.constraint_name
WHERE table_constraint.constraint_schema = 'public'
  AND table_constraint.constraint_type = 'FOREIGN KEY'
  AND table_constraint.table_name IN (
    'ReservationStatusAuditLog',
    'BusinessDayAuditLog',
    'ReservationCorrectionAuditLog',
    'ReservationLineLinkToken',
    'ReservationManagementToken',
    'NotificationEvent',
    'ReservationEmailOutbox',
    'ReservationIdempotency'
  )
ORDER BY table_constraint.table_name;

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'generate_unique_payment_reference_8',
    'create_order_quote_with_receipt_action',
    'consume_contact_rate_limit',
    'confirm_order_human_action',
    'set_order_payment_method_action',
    'mark_order_paid_action',
    'mark_order_collected_action',
    'mark_order_shipped_action',
    'cancel_order_action',
    'execute_terminal_order_action',
    'cleanup_expired_reservation_line_link_tokens'
  )
ORDER BY routine_name;

SELECT 'PASS' AS verification_status;
