-- Supabase Row-Level Security policies for order features.
-- Apply after supabase/schema.sql

alter table if exists public.orders enable row level security;
alter table if exists public.order_history enable row level security;
alter table if exists public.bank_account enable row level security;
alter table if exists public.order_actions enable row level security;
alter table if exists public.human_tokens enable row level security;
alter table if exists public.api_idempotency enable row level security;
alter table if exists public.order_notification_outbox enable row level security;
alter table if exists public.bank_account_history enable row level security;
alter table if exists public."Reservation" enable row level security;
alter table if exists public."PrivateBlockAuditLog" enable row level security;
alter table if exists public."ReservationStatusAuditLog" enable row level security;
alter table if exists public."ReservationRateLimitEvent" enable row level security;
alter table if exists public."BusinessDay" enable row level security;
alter table if exists public."MenuItem" enable row level security;
alter table if exists public."Photo" enable row level security;

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

drop policy if exists "order_notification_outbox_deny_anon_all" on public.order_notification_outbox;
drop policy if exists "order_notification_outbox_deny_authenticated_all" on public.order_notification_outbox;
drop policy if exists "order_notification_outbox_service_role_all" on public.order_notification_outbox;

drop policy if exists "bank_account_history_deny_anon_all" on public.bank_account_history;
drop policy if exists "bank_account_history_deny_authenticated_all" on public.bank_account_history;
drop policy if exists "bank_account_history_service_role_all" on public.bank_account_history;

drop policy if exists "reservation_deny_anon_all" on public."Reservation";
drop policy if exists "reservation_deny_authenticated_all" on public."Reservation";
drop policy if exists "reservation_service_role_all" on public."Reservation";

drop policy if exists "private_block_audit_deny_anon_all" on public."PrivateBlockAuditLog";
drop policy if exists "private_block_audit_deny_authenticated_all" on public."PrivateBlockAuditLog";
drop policy if exists "private_block_audit_service_role_all" on public."PrivateBlockAuditLog";

drop policy if exists "reservation_status_audit_deny_anon_all" on public."ReservationStatusAuditLog";
drop policy if exists "reservation_status_audit_deny_authenticated_all" on public."ReservationStatusAuditLog";
drop policy if exists "reservation_status_audit_service_role_all" on public."ReservationStatusAuditLog";

drop policy if exists "reservation_rate_limit_deny_anon_all" on public."ReservationRateLimitEvent";
drop policy if exists "reservation_rate_limit_deny_authenticated_all" on public."ReservationRateLimitEvent";
drop policy if exists "reservation_rate_limit_service_role_all" on public."ReservationRateLimitEvent";

drop policy if exists "business_day_deny_anon_all" on public."BusinessDay";
drop policy if exists "business_day_deny_authenticated_all" on public."BusinessDay";
drop policy if exists "business_day_service_role_all" on public."BusinessDay";

drop policy if exists "menu_item_deny_anon_all" on public."MenuItem";
drop policy if exists "menu_item_deny_authenticated_all" on public."MenuItem";
drop policy if exists "menu_item_service_role_all" on public."MenuItem";

drop policy if exists "photo_deny_anon_all" on public."Photo";
drop policy if exists "photo_deny_authenticated_all" on public."Photo";
drop policy if exists "photo_service_role_all" on public."Photo";

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

create policy "order_notification_outbox_deny_anon_all"
on public.order_notification_outbox
for all
to anon
using (false)
with check (false);

create policy "order_notification_outbox_deny_authenticated_all"
on public.order_notification_outbox
for all
to authenticated
using (false)
with check (false);

create policy "order_notification_outbox_service_role_all"
on public.order_notification_outbox
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

create policy "reservation_deny_anon_all" on public."Reservation" for all to anon using (false) with check (false);
create policy "reservation_deny_authenticated_all" on public."Reservation" for all to authenticated using (false) with check (false);
create policy "reservation_service_role_all" on public."Reservation" for all to service_role using (true) with check (true);

create policy "private_block_audit_deny_anon_all" on public."PrivateBlockAuditLog" for all to anon using (false) with check (false);
create policy "private_block_audit_deny_authenticated_all" on public."PrivateBlockAuditLog" for all to authenticated using (false) with check (false);
create policy "private_block_audit_service_role_all" on public."PrivateBlockAuditLog" for all to service_role using (true) with check (true);

create policy "reservation_status_audit_deny_anon_all" on public."ReservationStatusAuditLog" for all to anon using (false) with check (false);
create policy "reservation_status_audit_deny_authenticated_all" on public."ReservationStatusAuditLog" for all to authenticated using (false) with check (false);
create policy "reservation_status_audit_service_role_all" on public."ReservationStatusAuditLog" for all to service_role using (true) with check (true);

create policy "reservation_rate_limit_deny_anon_all" on public."ReservationRateLimitEvent" for all to anon using (false) with check (false);
create policy "reservation_rate_limit_deny_authenticated_all" on public."ReservationRateLimitEvent" for all to authenticated using (false) with check (false);
create policy "reservation_rate_limit_service_role_all" on public."ReservationRateLimitEvent" for all to service_role using (true) with check (true);

create policy "business_day_deny_anon_all" on public."BusinessDay" for all to anon using (false) with check (false);
create policy "business_day_deny_authenticated_all" on public."BusinessDay" for all to authenticated using (false) with check (false);
create policy "business_day_service_role_all" on public."BusinessDay" for all to service_role using (true) with check (true);

create policy "menu_item_deny_anon_all" on public."MenuItem" for all to anon using (false) with check (false);
create policy "menu_item_deny_authenticated_all" on public."MenuItem" for all to authenticated using (false) with check (false);
create policy "menu_item_service_role_all" on public."MenuItem" for all to service_role using (true) with check (true);

create policy "photo_deny_anon_all" on public."Photo" for all to anon using (false) with check (false);
create policy "photo_deny_authenticated_all" on public."Photo" for all to authenticated using (false) with check (false);
create policy "photo_service_role_all" on public."Photo" for all to service_role using (true) with check (true);
