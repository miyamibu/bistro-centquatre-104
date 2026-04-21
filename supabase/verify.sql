-- Verify required tables exist
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'orders',
    'order_history',
    'bank_account',
    'order_actions',
    'human_tokens',
    'api_idempotency',
    'bank_account_history'
  )
order by table_name;

-- Verify RLS is enabled on required tables
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'orders',
    'order_history',
    'bank_account',
    'order_actions',
    'human_tokens',
    'api_idempotency',
    'bank_account_history'
  )
order by c.relname;

-- Verify policies exist
select
  tablename,
  policyname,
  cmd,
  permissive,
  roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'orders',
    'order_history',
    'bank_account',
    'order_actions',
    'human_tokens',
    'api_idempotency',
    'bank_account_history'
  )
order by tablename, policyname;

-- Verify RPC functions exist
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'generate_unique_payment_reference_8',
    'confirm_order_human_action',
    'set_order_payment_method_action',
    'mark_order_paid_action',
    'mark_order_collected_action',
    'mark_order_shipped_action',
    'cancel_order_action'
  )
order by routine_name;
