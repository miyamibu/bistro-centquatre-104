-- bistro centquatre 104 production DB read-only checks
-- Date: 2026-06-21
--
-- Purpose:
--   Collect catalog-only evidence before approving production migration/deploy.
--   This script must not read customer rows, reservation contents, secrets, or PII.
--
-- How to run after explicit approval:
--   1. Connect to the intended production database with a read-only/session-safe tool.
--   2. Enable tuple-only export if desired, but do not paste connection strings into logs.
--   3. Run this file as a single read-only script.
--   4. Save output to a private evidence location with no customer data.
--
-- Safe output:
--   role names, table names, owner names, privilege types, RLS flags, policy names,
--   function security flags, search_path values, migration names/checksums.
--
-- NG conditions:
--   - The connected database/user is not the intended production target.
--   - Runtime role has BYPASSRLS or superuser.
--   - Runtime role has DELETE/TRUNCATE on business tables without explicit approval.
--   - Required RLS is disabled where policy-based protection is expected.
--   - SECURITY DEFINER functions lack a pinned search_path.
--   - Expected migrations/functions/tables are missing or drifted.
--   - Output includes customer row data, emails, phone numbers, addresses, or secrets.

begin;
set transaction read only;
set local statement_timeout = '15s';
set local lock_timeout = '2s';
set local idle_in_transaction_session_timeout = '60s';

select
  current_database() as current_database,
  current_user as current_user,
  session_user as session_user,
  current_setting('search_path') as effective_search_path,
  current_setting('server_version') as server_version;

select
  rolname,
  rolsuper,
  rolcreaterole,
  rolcreatedb,
  rolcanlogin,
  rolreplication,
  rolbypassrls
from pg_roles
where rolname in (current_user, session_user)
   or pg_has_role(current_user, oid, 'member')
order by rolname;

with target_tables(schema_name, table_name) as (
  values
    ('public', 'orders'),
    ('public', 'order_history'),
    ('public', 'order_actions'),
    ('public', 'human_tokens'),
    ('public', 'api_idempotency'),
    ('public', 'order_notification_outbox'),
    ('public', 'bank_account'),
    ('public', 'bank_account_history'),
    ('public', 'Reservation'),
    ('public', 'PrivateBlockAuditLog'),
    ('public', 'ReservationStatusAuditLog'),
    ('public', 'ReservationEmailOutbox'),
    ('public', 'ReservationIdempotency'),
    ('public', 'ReservationLineLinkToken'),
    ('public', 'NotificationEvent'),
    ('public', 'LineWebhookInbox'),
    ('public', 'ReservationRateLimitEvent'),
    ('public', 'BusinessDay')
)
select
  t.schema_name,
  t.table_name,
  c.relkind,
  pg_get_userbyid(c.relowner) as table_owner,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls,
  obj_description(c.oid, 'pg_class') as table_comment
from target_tables t
left join pg_class c
  on c.relname = t.table_name
left join pg_namespace n
  on n.oid = c.relnamespace
 and n.nspname = t.schema_name
order by t.schema_name, t.table_name;

with target_tables(schema_name, table_name) as (
  values
    ('public', 'orders'),
    ('public', 'order_history'),
    ('public', 'order_actions'),
    ('public', 'human_tokens'),
    ('public', 'api_idempotency'),
    ('public', 'order_notification_outbox'),
    ('public', 'bank_account'),
    ('public', 'bank_account_history'),
    ('public', 'Reservation'),
    ('public', 'PrivateBlockAuditLog'),
    ('public', 'ReservationStatusAuditLog'),
    ('public', 'ReservationEmailOutbox'),
    ('public', 'ReservationIdempotency'),
    ('public', 'ReservationLineLinkToken'),
    ('public', 'NotificationEvent'),
    ('public', 'LineWebhookInbox'),
    ('public', 'ReservationRateLimitEvent'),
    ('public', 'BusinessDay')
)
select
  t.schema_name,
  t.table_name,
  p.grantee,
  p.privilege_type,
  p.is_grantable
from target_tables t
left join information_schema.role_table_grants p
  on p.table_schema = t.schema_name
 and p.table_name = t.table_name
where p.grantee is null
   or p.grantee in (current_user, session_user, 'anon', 'authenticated', 'service_role', 'postgres')
order by t.schema_name, t.table_name, p.grantee, p.privilege_type;

with target_tables(schema_name, table_name) as (
  values
    ('public', 'orders'),
    ('public', 'order_history'),
    ('public', 'order_actions'),
    ('public', 'human_tokens'),
    ('public', 'api_idempotency'),
    ('public', 'order_notification_outbox'),
    ('public', 'bank_account'),
    ('public', 'bank_account_history'),
    ('public', 'Reservation'),
    ('public', 'PrivateBlockAuditLog'),
    ('public', 'ReservationStatusAuditLog'),
    ('public', 'ReservationEmailOutbox'),
    ('public', 'ReservationIdempotency'),
    ('public', 'ReservationLineLinkToken'),
    ('public', 'NotificationEvent'),
    ('public', 'LineWebhookInbox'),
    ('public', 'ReservationRateLimitEvent'),
    ('public', 'BusinessDay')
),
target_regclasses as (
  select
    schema_name,
    table_name,
    to_regclass(format('%I.%I', schema_name, table_name)) as relation_oid
  from target_tables
)
select
  schema_name,
  table_name,
  relation_oid is not null as exists,
  case when relation_oid is null then null else has_table_privilege(relation_oid, 'SELECT') end as current_user_can_select,
  case when relation_oid is null then null else has_table_privilege(relation_oid, 'INSERT') end as current_user_can_insert,
  case when relation_oid is null then null else has_table_privilege(relation_oid, 'UPDATE') end as current_user_can_update,
  case when relation_oid is null then null else has_table_privilege(relation_oid, 'DELETE') end as current_user_can_delete,
  case when relation_oid is null then null else has_table_privilege(relation_oid, 'TRUNCATE') end as current_user_can_truncate,
  case when relation_oid is null then null else has_table_privilege(relation_oid, 'REFERENCES') end as current_user_can_references,
  case when relation_oid is null then null else has_table_privilege(relation_oid, 'TRIGGER') end as current_user_can_trigger
from target_regclasses
order by schema_name, table_name;

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual is not null as has_using_expression,
  with_check is not null as has_with_check_expression
from pg_policies
where schemaname = 'public'
  and tablename in (
    'orders',
    'order_history',
    'order_actions',
    'human_tokens',
    'api_idempotency',
    'order_notification_outbox',
    'bank_account',
    'bank_account_history',
    'Reservation',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationIdempotency',
    'ReservationLineLinkToken',
    'NotificationEvent',
    'LineWebhookInbox',
    'ReservationRateLimitEvent',
    'BusinessDay'
  )
order by tablename, policyname;

select
  n.nspname as schema_name,
  c.relname as view_name,
  pg_get_userbyid(c.relowner) as view_owner,
  c.relkind,
  coalesce(c.reloptions::text, '') as view_options,
  coalesce(c.reloptions::text, '') ilike '%security_barrier=true%' as security_barrier
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('v', 'm')
order by view_name;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_userbyid(p.proowner) as function_owner,
  case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as security_mode,
  p.provolatile as volatility,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_settings,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_order_quote_action',
    'generate_unique_payment_reference_8',
    'confirm_order_human_action',
    'set_order_payment_method_action',
    'mark_order_paid_action',
    'mark_order_collected_action',
    'mark_order_shipped_action',
    'cancel_order_action',
    'execute_atomic_order_mutation',
    'execute_terminal_order_action',
    'save_bank_account_with_history',
    'delete_bank_account_with_history',
    'set_updated_at'
  )
order by function_name, args;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as is_security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_settings,
  case
    when p.prosecdef and coalesce(array_to_string(p.proconfig, ', '), '') not ilike '%search_path%'
      then 'NG_SECURITY_DEFINER_WITHOUT_PINNED_SEARCH_PATH'
    else 'OK_OR_NOT_SECURITY_DEFINER'
  end as search_path_assessment
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_order_quote_action',
    'set_order_payment_method_action',
    'save_bank_account_with_history',
    'delete_bank_account_with_history'
  )
order by function_name, args;

select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default is not null as has_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('order_notification_outbox', 'LineWebhookInbox')
order by ordinal_position;

with expected_columns(table_name, column_name) as (
  values
    ('order_notification_outbox', 'claim_token'),
    ('order_notification_outbox', 'customer_sent_at'),
    ('order_notification_outbox', 'admin_sent_at'),
    ('order_notification_outbox', 'admin_skipped_at'),
    ('api_idempotency', 'claim_token'),
    ('api_idempotency', 'claim_expires_at'),
    ('ReservationEmailOutbox', 'claimToken'),
    ('ReservationEmailOutbox', 'lockedUntil'),
    ('ReservationEmailOutbox', 'lastError'),
    ('LineWebhookInbox', 'eventId'),
    ('LineWebhookInbox', 'status'),
    ('LineWebhookInbox', 'attempts'),
    ('LineWebhookInbox', 'lockedUntil'),
    ('LineWebhookInbox', 'claimToken'),
    ('LineWebhookInbox', 'processedAt'),
    ('LineWebhookInbox', 'lastError')
)
select
  expected.table_name,
  expected.column_name,
  exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'public'
      and column_record.table_name = expected.table_name
      and column_record.column_name = expected.column_name
  ) as exists
from expected_columns expected
order by expected.table_name, expected.column_name;

select
  routine_schema,
  routine_name,
  routine_type,
  data_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'set_order_payment_method_action',
    'save_bank_account_with_history',
    'delete_bank_account_with_history',
    'create_order_quote_action',
    'confirm_order_human_action',
    'mark_order_paid_action',
    'mark_order_collected_action',
    'mark_order_shipped_action',
    'cancel_order_action',
    'execute_atomic_order_mutation',
    'execute_terminal_order_action'
  )
order by routine_name;

select
  to_regclass('public.order_notification_outbox') is not null as has_order_notification_outbox,
  to_regprocedure('public.execute_atomic_order_mutation(text,text,text,text,text,jsonb,jsonb,integer)') is not null as has_execute_atomic_order_mutation_rpc,
  to_regprocedure('public.execute_terminal_order_action(text,text,text,text,uuid,integer,text,text,text,text,text,text)') is not null as has_execute_terminal_order_action_rpc,
  to_regprocedure('public.set_order_payment_method_action(uuid,integer,text,date,timestamp with time zone,text,text,text,text,text)') is not null as has_set_payment_method_rpc,
  to_regprocedure('public.save_bank_account_with_history(text,text,text,text,text,text,text,text,text,text,text,integer)') is not null as has_save_bank_account_rpc,
  to_regprocedure('public.delete_bank_account_with_history(uuid,text,text,text,text,text,integer)') is not null as has_delete_bank_account_rpc;

select
  to_regclass('public._prisma_migrations') is not null as has_prisma_migrations_table;

select
  migration_name,
  finished_at is not null as applied,
  rolled_back_at is not null as rolled_back,
  checksum,
  logs is not null as has_logs
from public._prisma_migrations
where migration_name in (
  '20251215141633_init',
  '20260223224000_add_photo_category_column',
  '20260311130000_add_service_period_to_reservation',
  '20260407103000_add_reservation_type_to_reservation',
  '20260407153000_harden_private_block_invariants',
  '20260506093000_add_daily_journal_entry',
  '20260511120000_add_line_reminder_fields',
  '20260529150000_line_link_and_notification_ledger',
  '20260514120000_add_line_post_booking_link_fields',
  '20260622000000_add_reservation_status_audit_log',
  '20260728090000_add_reservation_email_outbox',
  '20260728093000_restrict_reservation_related_deletes'
)
order by migration_name;

do $assert_order_release_shape$
declare
  unsafe_runtime_roles text[];
  runtime_owned_tables text[];
  missing_columns text[];
  has_unique_identity boolean;
begin
  select array_agg(role_record.rolname order by role_record.rolname)
  into unsafe_runtime_roles
  from pg_roles role_record
  where role_record.rolname in ('bistro_app_runtime', 'bistro_preview_runtime')
    and (role_record.rolsuper or role_record.rolbypassrls);

  if coalesce(cardinality(unsafe_runtime_roles), 0) > 0 then
    raise exception 'FAIL runtime roles can bypass RLS: %',
      array_to_string(unsafe_runtime_roles, ', ');
  end if;

  select array_agg(format('%s:%s', owner_role.rolname, table_class.relname)
    order by owner_role.rolname, table_class.relname)
  into runtime_owned_tables
  from pg_class table_class
  join pg_namespace table_namespace on table_namespace.oid = table_class.relnamespace
  join pg_roles owner_role on owner_role.oid = table_class.relowner
  where table_namespace.nspname = 'public'
    and table_class.relkind in ('r', 'p')
    and owner_role.rolname in ('bistro_app_runtime', 'bistro_preview_runtime')
    and table_class.relname in (
      'orders', 'order_history', 'order_actions', 'human_tokens',
      'order_receipt_tokens', 'api_idempotency', 'order_notification_outbox',
      'Reservation', 'ReservationEmailOutbox', 'ReservationIdempotency'
    );

  if coalesce(cardinality(runtime_owned_tables), 0) > 0 then
    raise exception 'FAIL runtime roles own RLS-protected tables: %',
      array_to_string(runtime_owned_tables, ', ');
  end if;

  with expected_columns(column_name, udt_name) as (
    values ('claim_token', 'uuid'), ('claim_expires_at', 'timestamptz')
  )
  select array_agg(format('%s:%s', expected.column_name, expected.udt_name))
  into missing_columns
  from expected_columns expected
  where not exists (
    select 1
    from information_schema.columns column_record
    where column_record.table_schema = 'public'
      and column_record.table_name = 'api_idempotency'
      and column_record.column_name = expected.column_name
      and column_record.udt_name = expected.udt_name
  );

  if coalesce(cardinality(missing_columns), 0) > 0 then
    raise exception 'FAIL api_idempotency required columns missing or wrong type: %',
      array_to_string(missing_columns, ', ');
  end if;

  select exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.api_idempotency'::regclass
      and constraint_record.contype = 'u'
      and (
        select array_agg(attribute_record.attname order by key_record.ordinality)
        from unnest(constraint_record.conkey) with ordinality key_record(attnum, ordinality)
        join pg_attribute attribute_record
          on attribute_record.attrelid = constraint_record.conrelid
         and attribute_record.attnum = key_record.attnum
      ) = array['scope', 'actor_key', 'idempotency_key']::name[]
  ) into has_unique_identity;

  if not has_unique_identity then
    raise exception 'FAIL api_idempotency unique identity is missing';
  end if;

  if to_regclass('public.idx_api_idempotency_unfinalized_claim') is null then
    raise exception 'FAIL api_idempotency unfinished-claim index is missing';
  end if;
end
$assert_order_release_shape$;

do $assert_order_rpc_security$
declare
  expected_signatures text[] := array[
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
  security_definer boolean;
  function_settings text;
begin
  foreach signature in array expected_signatures loop
    procedure_oid := to_regprocedure(signature);
    if procedure_oid is null then
      raise exception 'FAIL required order RPC signature missing: %', signature;
    end if;

    select procedure.prosecdef, coalesce(array_to_string(procedure.proconfig, ', '), '')
    into security_definer, function_settings
    from pg_proc procedure
    where procedure.oid = procedure_oid;

    if security_definer then
      raise exception 'FAIL order RPC must be SECURITY INVOKER: %', signature;
    end if;

    if exists (
         select 1
         from pg_proc acl_procedure
         cross join lateral aclexplode(
           coalesce(acl_procedure.proacl, acldefault('f', acl_procedure.proowner))
         ) acl
         where acl_procedure.oid = procedure_oid
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
       )
       or has_function_privilege('anon', procedure_oid, 'EXECUTE')
       or has_function_privilege('authenticated', procedure_oid, 'EXECUTE') then
      raise exception 'FAIL order RPC is exposed outside service_role: %', signature;
    end if;

    if not has_function_privilege('service_role', procedure_oid, 'EXECUTE') then
      raise exception 'FAIL service_role cannot execute order RPC: %', signature;
    end if;

    if signature like 'public.execute_atomic_order_mutation(%'
       and function_settings not like '%search_path=pg_catalog, public%' then
      raise exception 'FAIL atomic order RPC search_path is not pinned';
    end if;
  end loop;
end
$assert_order_rpc_security$;

rollback;
