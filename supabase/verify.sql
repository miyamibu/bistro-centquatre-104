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
    'api_idempotency',
    'order_notification_outbox',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationLineLinkToken',
    'NotificationEvent',
    'ReservationRateLimitEvent',
    'BusinessDay',
    'MenuItem',
    'Photo'
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
    'api_idempotency',
    'order_notification_outbox',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationLineLinkToken',
    'NotificationEvent',
    'ReservationRateLimitEvent',
    'BusinessDay',
    'MenuItem',
    'Photo'
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
      ('api_idempotency', 'api_idempotency'),
      ('order_notification_outbox', 'order_notification_outbox'),
      ('bank_account_history', 'bank_account_history'),
      ('Reservation', 'reservation'),
      ('PrivateBlockAuditLog', 'private_block_audit'),
      ('ReservationStatusAuditLog', 'reservation_status_audit'),
      ('ReservationEmailOutbox', 'reservation_email_outbox'),
      ('ReservationLineLinkToken', 'reservation_line_link_token'),
      ('NotificationEvent', 'notification_event'),
      ('ReservationRateLimitEvent', 'reservation_rate_limit'),
      ('BusinessDay', 'business_day'),
      ('MenuItem', 'menu_item'),
      ('Photo', 'photo')
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
      ('ReservationLineLinkToken'),
      ('NotificationEvent')
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
      ('NotificationEvent', 'NotificationEvent_reservationId_fkey'),
      ('ReservationEmailOutbox', 'ReservationEmailOutbox_reservationId_fkey')
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

DO $verify_runtime_role$
DECLARE
  configured_runtime_role text := nullif(current_setting('bistro.verify_runtime_role', true), '');
  runtime_role text;
  missing_grants text[];
  forbidden_grants text[];
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
    WITH privilege_requirements(table_name, privileges) AS (
      VALUES
        ('Reservation', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('BusinessDay', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('PrivateBlockAuditLog', ARRAY['SELECT', 'INSERT']::text[]),
        ('ReservationStatusAuditLog', ARRAY['SELECT', 'INSERT']::text[]),
        ('ReservationEmailOutbox', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('ReservationLineLinkToken', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('NotificationEvent', ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]),
        ('ReservationRateLimitEvent', ARRAY['SELECT', 'INSERT']::text[])
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
        ('PrivateBlockAuditLog'),
        ('ReservationStatusAuditLog'),
        ('ReservationEmailOutbox'),
        ('ReservationLineLinkToken'),
        ('NotificationEvent'),
        ('ReservationRateLimitEvent')
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

    RAISE NOTICE 'PASS runtime role grants: %', runtime_role;
  END IF;
END
$verify_runtime_role$;

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
    'api_idempotency',
    'order_notification_outbox',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationLineLinkToken',
    'NotificationEvent',
    'ReservationRateLimitEvent',
    'BusinessDay',
    'MenuItem',
    'Photo'
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
    'api_idempotency',
    'order_notification_outbox',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationLineLinkToken',
    'NotificationEvent',
    'ReservationRateLimitEvent',
    'BusinessDay',
    'MenuItem',
    'Photo'
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
    'api_idempotency',
    'order_notification_outbox',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationLineLinkToken',
    'NotificationEvent',
    'ReservationRateLimitEvent',
    'BusinessDay',
    'MenuItem',
    'Photo'
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
    'ReservationLineLinkToken',
    'NotificationEvent',
    'ReservationEmailOutbox'
  )
ORDER BY table_constraint.table_name;

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'generate_unique_payment_reference_8',
    'confirm_order_human_action',
    'set_order_payment_method_action',
    'mark_order_paid_action',
    'mark_order_collected_action',
    'mark_order_shipped_action',
    'cancel_order_action'
  )
ORDER BY routine_name;

SELECT 'PASS' AS verification_status;
