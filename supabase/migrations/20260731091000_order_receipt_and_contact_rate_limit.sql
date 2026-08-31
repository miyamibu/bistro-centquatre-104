create table if not exists public.order_receipt_tokens (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_order_receipt_tokens_order_id
  on public.order_receipt_tokens (order_id);

alter table public.order_receipt_tokens enable row level security;

drop policy if exists "order_receipt_tokens_deny_anon_all" on public.order_receipt_tokens;
drop policy if exists "order_receipt_tokens_deny_authenticated_all" on public.order_receipt_tokens;
drop policy if exists "order_receipt_tokens_service_role_all" on public.order_receipt_tokens;

create policy "order_receipt_tokens_deny_anon_all"
on public.order_receipt_tokens
for all
to anon
using (false)
with check (false);

create policy "order_receipt_tokens_deny_authenticated_all"
on public.order_receipt_tokens
for all
to authenticated
using (false)
with check (false);

create policy "order_receipt_tokens_service_role_all"
on public.order_receipt_tokens
for all
to service_role
using (true)
with check (true);

create or replace function public.create_order_quote_with_receipt_action(
  p_customer_name text,
  p_email text,
  p_phone text,
  p_zip_code text,
  p_prefecture text,
  p_city text,
  p_address text,
  p_building text,
  p_items jsonb,
  p_total integer,
  p_hold_expires_at timestamptz,
  p_token_hash text,
  p_actor_id text,
  p_request_id text,
  p_idempotency_key text,
  p_selected_payment_method text,
  p_selected_store_visit_date date default null,
  p_receipt_token_hash text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
  v_order_id uuid;
begin
  if p_receipt_token_hash is null or length(trim(p_receipt_token_hash)) <> 64 then
    raise exception 'ORDER_RECEIPT_TOKEN_REQUIRED';
  end if;

  v_result := public.create_order_quote_action(
    p_customer_name => p_customer_name,
    p_email => p_email,
    p_phone => p_phone,
    p_zip_code => p_zip_code,
    p_prefecture => p_prefecture,
    p_city => p_city,
    p_address => p_address,
    p_building => p_building,
    p_items => p_items,
    p_total => p_total,
    p_hold_expires_at => p_hold_expires_at,
    p_token_hash => p_token_hash,
    p_actor_id => p_actor_id,
    p_request_id => p_request_id,
    p_idempotency_key => p_idempotency_key,
    p_selected_payment_method => p_selected_payment_method,
    p_selected_store_visit_date => p_selected_store_visit_date
  );

  v_order_id := nullif(v_result -> 'order' ->> 'id', '')::uuid;
  if v_order_id is null then
    raise exception 'ORDER_RECEIPT_ORDER_ID_MISSING';
  end if;

  insert into public.order_receipt_tokens (
    order_id,
    token_hash,
    expires_at
  ) values (
    v_order_id,
    lower(trim(p_receipt_token_hash)),
    now() + interval '30 days'
  );

  return v_result;
end;
$$;

create table if not exists public.contact_rate_limit_buckets (
  scope text not null check (scope in ('IP', 'EMAIL')),
  key_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

alter table public.contact_rate_limit_buckets enable row level security;

drop policy if exists "contact_rate_limit_buckets_deny_anon_all" on public.contact_rate_limit_buckets;
drop policy if exists "contact_rate_limit_buckets_deny_authenticated_all" on public.contact_rate_limit_buckets;
drop policy if exists "contact_rate_limit_buckets_service_role_all" on public.contact_rate_limit_buckets;

create policy "contact_rate_limit_buckets_deny_anon_all"
on public.contact_rate_limit_buckets
for all
to anon
using (false)
with check (false);

create policy "contact_rate_limit_buckets_deny_authenticated_all"
on public.contact_rate_limit_buckets
for all
to authenticated
using (false)
with check (false);

create policy "contact_rate_limit_buckets_service_role_all"
on public.contact_rate_limit_buckets
for all
to service_role
using (true)
with check (true);

create or replace function public.consume_contact_rate_limit(
  p_ip_hash text,
  p_email_hash text,
  p_window_seconds integer default 600,
  p_ip_max_requests integer default 5,
  p_email_max_requests integer default 3,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
as $$
declare
  v_scope text;
  v_key_hash text;
  v_max_requests integer;
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  if p_window_seconds <= 0 or p_ip_max_requests <= 0 or p_email_max_requests <= 0 then
    return false;
  end if;

  for v_scope, v_key_hash, v_max_requests in
    select key_scope, key_value, max_requests
    from (
      values
        ('EMAIL'::text, nullif(trim(p_email_hash), ''), p_email_max_requests),
        ('IP'::text, nullif(trim(p_ip_hash), ''), p_ip_max_requests)
    ) as keys(key_scope, key_value, max_requests)
    where key_value is not null
    order by key_scope, key_value
  loop
    perform pg_advisory_xact_lock(
      hashtext('bistro:contact-rate:' || v_scope || ':' || v_key_hash)
    );
  end loop;

  for v_scope, v_key_hash, v_max_requests in
    select key_scope, key_value, max_requests
    from (
      values
        ('EMAIL'::text, nullif(trim(p_email_hash), ''), p_email_max_requests),
        ('IP'::text, nullif(trim(p_ip_hash), ''), p_ip_max_requests)
    ) as keys(key_scope, key_value, max_requests)
    where key_value is not null
    order by key_scope, key_value
  loop
    select window_started_at, request_count
    into v_window_started_at, v_request_count
    from public.contact_rate_limit_buckets
    where scope = v_scope
      and key_hash = v_key_hash
    for update;

    if found
       and v_window_started_at > p_now - make_interval(secs => p_window_seconds)
       and v_request_count >= v_max_requests then
      return false;
    end if;
  end loop;

  for v_scope, v_key_hash, v_max_requests in
    select key_scope, key_value, max_requests
    from (
      values
        ('EMAIL'::text, nullif(trim(p_email_hash), ''), p_email_max_requests),
        ('IP'::text, nullif(trim(p_ip_hash), ''), p_ip_max_requests)
    ) as keys(key_scope, key_value, max_requests)
    where key_value is not null
    order by key_scope, key_value
  loop
    insert into public.contact_rate_limit_buckets (
      scope,
      key_hash,
      window_started_at,
      request_count,
      updated_at
    ) values (
      v_scope,
      v_key_hash,
      p_now,
      1,
      p_now
    )
    on conflict (scope, key_hash) do update
    set
      window_started_at = case
        when public.contact_rate_limit_buckets.window_started_at <= p_now - make_interval(secs => p_window_seconds)
          then excluded.window_started_at
        else public.contact_rate_limit_buckets.window_started_at
      end,
      request_count = case
        when public.contact_rate_limit_buckets.window_started_at <= p_now - make_interval(secs => p_window_seconds)
          then 1
        else public.contact_rate_limit_buckets.request_count + 1
      end,
      updated_at = excluded.updated_at;
  end loop;

  return true;
end;
$$;

revoke all on function public.create_order_quote_with_receipt_action(
  text, text, text, text, text, text, text, text, jsonb, integer, timestamptz,
  text, text, text, text, text, date, text
) from public;
grant execute on function public.create_order_quote_with_receipt_action(
  text, text, text, text, text, text, text, text, jsonb, integer, timestamptz,
  text, text, text, text, text, date, text
) to service_role;

revoke all on function public.consume_contact_rate_limit(
  text, text, integer, integer, integer, timestamptz
) from public;
grant execute on function public.consume_contact_rate_limit(
  text, text, integer, integer, integer, timestamptz
) to service_role;
