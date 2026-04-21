-- Supabase Row-Level Security policies for order features.
-- Apply after supabase/schema.sql

alter table if exists public.orders enable row level security;
alter table if exists public.order_history enable row level security;
alter table if exists public.bank_account enable row level security;
alter table if exists public.order_actions enable row level security;
alter table if exists public.human_tokens enable row level security;
alter table if exists public.api_idempotency enable row level security;
alter table if exists public.bank_account_history enable row level security;

drop policy if exists "orders_deny_anon_all" on public.orders;
drop policy if exists "orders_deny_authenticated_all" on public.orders;
drop policy if exists "orders_service_role_all" on public.orders;

drop policy if exists "order_history_deny_anon_all" on public.order_history;
drop policy if exists "order_history_deny_authenticated_all" on public.order_history;
drop policy if exists "order_history_service_role_all" on public.order_history;

drop policy if exists "bank_account_deny_anon_all" on public.bank_account;
drop policy if exists "bank_account_deny_authenticated_all" on public.bank_account;
drop policy if exists "bank_account_service_role_all" on public.bank_account;

drop policy if exists "order_actions_deny_anon_all" on public.order_actions;
drop policy if exists "order_actions_deny_authenticated_all" on public.order_actions;
drop policy if exists "order_actions_service_role_all" on public.order_actions;

drop policy if exists "human_tokens_deny_anon_all" on public.human_tokens;
drop policy if exists "human_tokens_deny_authenticated_all" on public.human_tokens;
drop policy if exists "human_tokens_service_role_all" on public.human_tokens;

drop policy if exists "api_idempotency_deny_anon_all" on public.api_idempotency;
drop policy if exists "api_idempotency_deny_authenticated_all" on public.api_idempotency;
drop policy if exists "api_idempotency_service_role_all" on public.api_idempotency;

drop policy if exists "bank_account_history_deny_anon_all" on public.bank_account_history;
drop policy if exists "bank_account_history_deny_authenticated_all" on public.bank_account_history;
drop policy if exists "bank_account_history_service_role_all" on public.bank_account_history;

create policy "orders_deny_anon_all"
on public.orders
for all
to anon
using (false)
with check (false);

create policy "orders_deny_authenticated_all"
on public.orders
for all
to authenticated
using (false)
with check (false);

create policy "orders_service_role_all"
on public.orders
for all
to service_role
using (true)
with check (true);

create policy "order_history_deny_anon_all"
on public.order_history
for all
to anon
using (false)
with check (false);

create policy "order_history_deny_authenticated_all"
on public.order_history
for all
to authenticated
using (false)
with check (false);

create policy "order_history_service_role_all"
on public.order_history
for all
to service_role
using (true)
with check (true);

create policy "bank_account_deny_anon_all"
on public.bank_account
for all
to anon
using (false)
with check (false);

create policy "bank_account_deny_authenticated_all"
on public.bank_account
for all
to authenticated
using (false)
with check (false);

create policy "bank_account_service_role_all"
on public.bank_account
for all
to service_role
using (true)
with check (true);

create policy "order_actions_deny_anon_all"
on public.order_actions
for all
to anon
using (false)
with check (false);

create policy "order_actions_deny_authenticated_all"
on public.order_actions
for all
to authenticated
using (false)
with check (false);

create policy "order_actions_service_role_all"
on public.order_actions
for all
to service_role
using (true)
with check (true);

create policy "human_tokens_deny_anon_all"
on public.human_tokens
for all
to anon
using (false)
with check (false);

create policy "human_tokens_deny_authenticated_all"
on public.human_tokens
for all
to authenticated
using (false)
with check (false);

create policy "human_tokens_service_role_all"
on public.human_tokens
for all
to service_role
using (true)
with check (true);

create policy "api_idempotency_deny_anon_all"
on public.api_idempotency
for all
to anon
using (false)
with check (false);

create policy "api_idempotency_deny_authenticated_all"
on public.api_idempotency
for all
to authenticated
using (false)
with check (false);

create policy "api_idempotency_service_role_all"
on public.api_idempotency
for all
to service_role
using (true)
with check (true);

create policy "bank_account_history_deny_anon_all"
on public.bank_account_history
for all
to anon
using (false)
with check (false);

create policy "bank_account_history_deny_authenticated_all"
on public.bank_account_history
for all
to authenticated
using (false)
with check (false);

create policy "bank_account_history_service_role_all"
on public.bank_account_history
for all
to service_role
using (true)
with check (true);
