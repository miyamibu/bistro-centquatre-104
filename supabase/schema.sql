-- Supabase order-related schema (v2)
-- Apply this before supabase/rls-policies.sql

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  email text not null,
  phone text not null,
  zip_code text not null,
  prefecture text not null,
  city text not null,
  address text not null,
  building text,
  payment_method text check (payment_method in ('BANK_TRANSFER', 'PAY_IN_STORE')),
  payment_reference text,
  items jsonb not null default '[]'::jsonb,
  total integer not null check (total >= 0),
  store_visit_date date,
  status text not null default 'QUOTED' check (status in ('QUOTED', 'PENDING_PAYMENT', 'PAID', 'SHIPPED', 'CANCELLED')),
  hold_expires_at timestamptz,
  expires_at timestamptz,
  human_confirmed_at timestamptz,
  human_confirmed_expires_at timestamptz,
  human_confirmed_by text,
  paid_at timestamptz,
  shipped_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_state_consistency check (
    (status = 'QUOTED'
      and payment_method is null
      and payment_reference is null
      and paid_at is null
      and shipped_at is null
      and canceled_at is null)
    or
    (status = 'PENDING_PAYMENT'
      and payment_method is not null
      and (
        (payment_method = 'BANK_TRANSFER' and payment_reference is not null)
        or
        (payment_method = 'PAY_IN_STORE' and payment_reference is null)
      )
      and paid_at is null
      and shipped_at is null
      and canceled_at is null)
    or
    (status = 'PAID'
      and payment_method is not null
      and paid_at is not null
      and canceled_at is null)
    or
    (status = 'SHIPPED'
      and payment_method is not null
      and paid_at is not null
      and shipped_at is not null
      and canceled_at is null)
    or
    (status = 'CANCELLED'
      and canceled_at is not null)
  )
);

create table if not exists public.order_history (
  id uuid primary key,
  customer_name text not null,
  email text not null,
  phone text not null,
  zip_code text not null,
  prefecture text not null,
  city text not null,
  address text not null,
  building text,
  payment_method text check (payment_method in ('BANK_TRANSFER', 'PAY_IN_STORE')),
  payment_reference text,
  items jsonb not null,
  total integer not null check (total >= 0),
  store_visit_date date,
  status text not null check (status in ('SHIPPED', 'CANCELLED')),
  paid_at timestamptz,
  shipped_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  version integer not null default 0,
  created_at timestamptz not null,
  deleted_at timestamptz not null default now()
);

create table if not exists public.bank_account (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  branch_name text not null,
  account_type text not null,
  account_number text not null,
  account_holder text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_actions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  action_type text not null check (
    action_type in (
      'QUOTE_CREATED',
      'HUMAN_CONFIRMED',
      'SET_PAYMENT_METHOD',
      'PAYMENT_REFERENCE_ISSUED',
      'MARK_PAID',
      'MARK_COLLECTED',
      'MARK_SHIPPED',
      'CANCELLED',
      'EXPIRED_HOLD',
      'EXPIRED_PAYMENT',
      'PAYMENT_RECONCILIATION_FAILED'
    )
  ),
  actor_type text not null check (actor_type in ('user', 'admin', 'agent', 'cron', 'system')),
  actor_id text,
  request_id text,
  idempotency_key text,
  from_status text,
  to_status text,
  version_before integer,
  version_after integer,
  payment_method_before text,
  payment_method_after text,
  payment_reference text,
  amount_snapshot integer,
  reason_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.human_tokens (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.api_idempotency (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  idempotency_key text not null,
  actor_key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  resource_id text,
  created_at timestamptz not null default now(),
  unique (scope, actor_key, idempotency_key)
);

create table if not exists public.bank_account_history (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid,
  action_type text not null check (action_type in ('UPDATED', 'DELETED')),
  changed_by text not null,
  changed_at timestamptz not null default now(),
  bank_name text not null,
  branch_name text not null,
  account_type text not null,
  account_number_last4 text not null,
  account_number_enc text not null,
  account_holder_enc text not null,
  account_number_nonce text not null,
  account_number_auth_tag text not null,
  account_holder_nonce text not null,
  account_holder_auth_tag text not null,
  key_version integer not null
);

create unique index if not exists uq_orders_payment_reference_active
  on public.orders (payment_reference)
  where payment_reference is not null and canceled_at is null;

create index if not exists idx_orders_created_at on public.orders (created_at desc);
create index if not exists idx_orders_store_visit_date on public.orders (store_visit_date);
create index if not exists idx_orders_hold_expires_at on public.orders (hold_expires_at);
create index if not exists idx_orders_expires_at on public.orders (expires_at);
create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_payment_method on public.orders (payment_method);
create index if not exists idx_orders_canceled_at on public.orders (canceled_at);
create index if not exists idx_orders_active_expiry
  on public.orders (status, expires_at)
  where canceled_at is null;

create index if not exists idx_order_history_deleted_at on public.order_history (deleted_at);
create index if not exists idx_order_actions_order_created on public.order_actions (order_id, created_at desc);
create index if not exists idx_order_actions_action_created on public.order_actions (action_type, created_at desc);
create index if not exists idx_human_tokens_order_active
  on public.human_tokens (order_id, expires_at)
  where used_at is null;
create index if not exists idx_api_idempotency_created_at on public.api_idempotency (created_at);
create index if not exists idx_bank_account_history_changed_at on public.bank_account_history (changed_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_orders_set_updated_at on public.orders;
create trigger trg_orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

drop trigger if exists trg_bank_account_set_updated_at on public.bank_account;
create trigger trg_bank_account_set_updated_at
before update on public.bank_account
for each row
execute function public.set_updated_at();

create or replace function public.generate_unique_payment_reference_8()
returns text
language plpgsql
as $$
declare
  candidate text;
  try_count integer := 0;
begin
  loop
    candidate := lpad((floor(random() * 100000000)::bigint)::text, 8, '0');
    exit when not exists (
      select 1
      from public.orders
      where payment_reference = candidate
        and canceled_at is null
    );

    try_count := try_count + 1;
    if try_count >= 20 then
      raise exception 'PAYMENT_REFERENCE_GENERATION_FAILED';
    end if;
  end loop;

  return candidate;
end;
$$;

create or replace function public.confirm_order_human_action(
  p_order_id uuid,
  p_expected_version integer,
  p_token_hash text,
  p_actor_id text,
  p_request_id text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_token public.human_tokens%rowtype;
  v_updated public.orders%rowtype;
  v_action_id uuid;
  v_action_created_at timestamptz;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  select *
  into v_token
  from public.human_tokens
  where order_id = p_order_id
    and token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'HUMAN_TOKEN_INVALID';
  end if;

  if v_token.used_at is not null or v_token.expires_at <= now() then
    raise exception 'HUMAN_TOKEN_EXPIRED';
  end if;

  update public.human_tokens
  set used_at = now()
  where id = v_token.id;

  update public.orders
  set
    human_confirmed_at = now(),
    human_confirmed_expires_at = now() + interval '15 minutes',
    human_confirmed_by = coalesce(p_actor_id, 'human-token'),
    updated_at = now()
  where id = p_order_id
  returning *
  into v_updated;

  insert into public.order_actions (
    order_id,
    action_type,
    actor_type,
    actor_id,
    request_id,
    idempotency_key,
    from_status,
    to_status,
    version_before,
    version_after,
    payment_method_before,
    payment_method_after,
    payment_reference,
    amount_snapshot,
    metadata
  ) values (
    v_updated.id,
    'HUMAN_CONFIRMED',
    'user',
    p_actor_id,
    p_request_id,
    p_idempotency_key,
    v_order.status,
    v_updated.status,
    v_order.version,
    v_updated.version,
    v_order.payment_method,
    v_updated.payment_method,
    v_updated.payment_reference,
    v_updated.total,
    jsonb_build_object('human_token_id', v_token.id)
  )
  returning id, created_at
  into v_action_id, v_action_created_at;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_updated.id,
      'status', v_updated.status,
      'version', v_updated.version
    ),
    'action', jsonb_build_object(
      'id', v_action_id,
      'type', 'HUMAN_CONFIRMED',
      'createdAt', v_action_created_at
    )
  );
end;
$$;

create or replace function public.set_order_payment_method_action(
  p_order_id uuid,
  p_expected_version integer,
  p_payment_method text,
  p_store_visit_date date,
  p_expires_at timestamptz,
  p_actor_type text,
  p_actor_id text,
  p_request_id text,
  p_idempotency_key text,
  p_token_hash text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_token public.human_tokens%rowtype;
  v_updated public.orders%rowtype;
  v_action_id uuid;
  v_action_created_at timestamptz;
  v_payment_reference text := null;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  if v_order.status <> 'QUOTED' then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  if v_order.canceled_at is not null then
    raise exception 'ALREADY_CANCELLED';
  end if;

  if p_token_hash is not null then
    select *
    into v_token
    from public.human_tokens
    where order_id = p_order_id
      and token_hash = p_token_hash
    for update;

    if not found then
      raise exception 'HUMAN_TOKEN_INVALID';
    end if;

    if v_token.used_at is not null or v_token.expires_at <= now() then
      raise exception 'HUMAN_TOKEN_EXPIRED';
    end if;
  elsif v_order.human_confirmed_expires_at is null or v_order.human_confirmed_expires_at <= now() then
    raise exception 'HUMAN_CONFIRMATION_REQUIRED';
  end if;

  if p_payment_method not in ('BANK_TRANSFER', 'PAY_IN_STORE') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  if p_payment_method = 'PAY_IN_STORE' and p_store_visit_date is null then
    raise exception 'STORE_VISIT_DATE_REQUIRED';
  end if;

  if p_payment_method = 'PAY_IN_STORE' and extract(dow from p_store_visit_date) not in (0, 4, 5, 6) then
    raise exception 'STORE_VISIT_NOT_BUSINESS_DAY';
  end if;

  if p_payment_method = 'PAY_IN_STORE'
     and (
       p_store_visit_date < ((now() at time zone 'Asia/Tokyo')::date + 14)
       or p_store_visit_date > ((now() at time zone 'Asia/Tokyo')::date + 30)
     ) then
    raise exception 'STORE_VISIT_OUT_OF_RANGE';
  end if;

  if p_payment_method = 'BANK_TRANSFER' then
    v_payment_reference := public.generate_unique_payment_reference_8();
  end if;

  if p_token_hash is not null then
    update public.human_tokens
    set used_at = now()
    where id = v_token.id;

    insert into public.order_actions (
      order_id,
      action_type,
      actor_type,
      actor_id,
      request_id,
      idempotency_key,
      from_status,
      to_status,
      version_before,
      version_after,
      payment_method_before,
      payment_method_after,
      payment_reference,
      amount_snapshot,
      metadata
    ) values (
      v_order.id,
      'HUMAN_CONFIRMED',
      'user',
      p_actor_id,
      p_request_id,
      p_idempotency_key,
      v_order.status,
      v_order.status,
      v_order.version,
      v_order.version,
      v_order.payment_method,
      v_order.payment_method,
      v_order.payment_reference,
      v_order.total,
      jsonb_build_object('human_token_id', v_token.id)
    );
  end if;

  update public.orders
  set
    payment_method = p_payment_method,
    payment_reference = v_payment_reference,
    store_visit_date = case
      when p_payment_method = 'PAY_IN_STORE' then p_store_visit_date
      else null
    end,
    hold_expires_at = null,
    expires_at = p_expires_at,
    human_confirmed_at = case
      when p_token_hash is not null then now()
      else human_confirmed_at
    end,
    human_confirmed_expires_at = case
      when p_token_hash is not null then now() + interval '15 minutes'
      else human_confirmed_expires_at
    end,
    human_confirmed_by = case
      when p_token_hash is not null then coalesce(p_actor_id, 'human-token')
      else human_confirmed_by
    end,
    status = 'PENDING_PAYMENT',
    version = version + 1,
    updated_at = now()
  where id = p_order_id
    and version = p_expected_version
  returning *
  into v_updated;

  if not found then
    raise exception 'VERSION_CONFLICT';
  end if;

  insert into public.order_actions (
    order_id,
    action_type,
    actor_type,
    actor_id,
    request_id,
    idempotency_key,
    from_status,
    to_status,
    version_before,
    version_after,
    payment_method_before,
    payment_method_after,
    payment_reference,
    amount_snapshot,
    metadata
  ) values (
    v_updated.id,
    'SET_PAYMENT_METHOD',
    p_actor_type,
    p_actor_id,
    p_request_id,
    p_idempotency_key,
    v_order.status,
    v_updated.status,
    v_order.version,
    v_updated.version,
    v_order.payment_method,
    v_updated.payment_method,
    v_updated.payment_reference,
    v_updated.total,
    jsonb_build_object(
      'store_visit_date', v_updated.store_visit_date,
      'expires_at', v_updated.expires_at
    )
  )
  returning id, created_at
  into v_action_id, v_action_created_at;

  if v_payment_reference is not null then
    insert into public.order_actions (
      order_id,
      action_type,
      actor_type,
      actor_id,
      request_id,
      idempotency_key,
      from_status,
      to_status,
      version_before,
      version_after,
      payment_reference,
      amount_snapshot,
      metadata
    ) values (
      v_updated.id,
      'PAYMENT_REFERENCE_ISSUED',
      'system',
      null,
      p_request_id,
      p_idempotency_key,
      v_order.status,
      v_updated.status,
      v_order.version,
      v_updated.version,
      v_payment_reference,
      v_updated.total,
      '{}'::jsonb
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_updated.id,
      'status', v_updated.status,
      'paymentMethod', v_updated.payment_method,
      'paymentReference', v_updated.payment_reference,
      'version', v_updated.version,
      'expiresAt', v_updated.expires_at
    ),
    'action', jsonb_build_object(
      'id', v_action_id,
      'type', 'SET_PAYMENT_METHOD',
      'createdAt', v_action_created_at
    )
  );
end;
$$;

create or replace function public.mark_order_paid_action(
  p_order_id uuid,
  p_expected_version integer,
  p_payment_reference text,
  p_received_amount integer,
  p_actor_type text,
  p_actor_id text,
  p_request_id text,
  p_idempotency_key text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_action_id uuid;
  v_action_created_at timestamptz;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  if v_order.status <> 'PENDING_PAYMENT' then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  if v_order.payment_method <> 'BANK_TRANSFER' then
    raise exception 'PAYMENT_METHOD_MISMATCH';
  end if;

  if v_order.payment_reference <> p_payment_reference then
    insert into public.order_actions (
      order_id, action_type, actor_type, actor_id, request_id, idempotency_key,
      from_status, to_status, version_before, version_after,
      payment_reference, amount_snapshot, reason_code, metadata
    ) values (
      v_order.id, 'PAYMENT_RECONCILIATION_FAILED', p_actor_type, p_actor_id, p_request_id, p_idempotency_key,
      v_order.status, v_order.status, v_order.version, v_order.version,
      p_payment_reference, v_order.total, 'PAYMENT_REFERENCE_MISMATCH',
      jsonb_build_object('adminNote', p_admin_note)
    );
    raise exception 'PAYMENT_REFERENCE_MISMATCH';
  end if;

  if v_order.total <> p_received_amount then
    insert into public.order_actions (
      order_id, action_type, actor_type, actor_id, request_id, idempotency_key,
      from_status, to_status, version_before, version_after,
      payment_reference, amount_snapshot, reason_code, metadata
    ) values (
      v_order.id, 'PAYMENT_RECONCILIATION_FAILED', p_actor_type, p_actor_id, p_request_id, p_idempotency_key,
      v_order.status, v_order.status, v_order.version, v_order.version,
      v_order.payment_reference, v_order.total, 'PAYMENT_AMOUNT_MISMATCH',
      jsonb_build_object('receivedAmount', p_received_amount, 'adminNote', p_admin_note)
    );
    raise exception 'PAYMENT_AMOUNT_MISMATCH';
  end if;

  update public.orders
  set
    paid_at = now(),
    status = 'PAID',
    version = version + 1,
    updated_at = now()
  where id = p_order_id
    and version = p_expected_version
  returning *
  into v_updated;

  if not found then
    raise exception 'VERSION_CONFLICT';
  end if;

  insert into public.order_actions (
    order_id,
    action_type,
    actor_type,
    actor_id,
    request_id,
    idempotency_key,
    from_status,
    to_status,
    version_before,
    version_after,
    payment_method_before,
    payment_method_after,
    payment_reference,
    amount_snapshot,
    metadata
  ) values (
    v_updated.id,
    'MARK_PAID',
    p_actor_type,
    p_actor_id,
    p_request_id,
    p_idempotency_key,
    v_order.status,
    v_updated.status,
    v_order.version,
    v_updated.version,
    v_order.payment_method,
    v_updated.payment_method,
    v_updated.payment_reference,
    v_updated.total,
    jsonb_build_object('receivedAmount', p_received_amount, 'adminNote', p_admin_note)
  )
  returning id, created_at
  into v_action_id, v_action_created_at;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_updated.id,
      'status', v_updated.status,
      'paidAt', v_updated.paid_at,
      'version', v_updated.version
    ),
    'action', jsonb_build_object(
      'id', v_action_id,
      'type', 'MARK_PAID',
      'createdAt', v_action_created_at
    )
  );
end;
$$;

create or replace function public.mark_order_collected_action(
  p_order_id uuid,
  p_expected_version integer,
  p_received_amount integer,
  p_actor_type text,
  p_actor_id text,
  p_request_id text,
  p_idempotency_key text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_action_id uuid;
  v_action_created_at timestamptz;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  if v_order.status <> 'PENDING_PAYMENT' then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  if v_order.payment_method <> 'PAY_IN_STORE' then
    raise exception 'PAYMENT_METHOD_MISMATCH';
  end if;

  if v_order.total <> p_received_amount then
    raise exception 'PAYMENT_AMOUNT_MISMATCH';
  end if;

  update public.orders
  set
    paid_at = now(),
    status = 'PAID',
    version = version + 1,
    updated_at = now()
  where id = p_order_id
    and version = p_expected_version
  returning *
  into v_updated;

  if not found then
    raise exception 'VERSION_CONFLICT';
  end if;

  insert into public.order_actions (
    order_id,
    action_type,
    actor_type,
    actor_id,
    request_id,
    idempotency_key,
    from_status,
    to_status,
    version_before,
    version_after,
    payment_method_before,
    payment_method_after,
    amount_snapshot,
    metadata
  ) values (
    v_updated.id,
    'MARK_COLLECTED',
    p_actor_type,
    p_actor_id,
    p_request_id,
    p_idempotency_key,
    v_order.status,
    v_updated.status,
    v_order.version,
    v_updated.version,
    v_order.payment_method,
    v_updated.payment_method,
    v_updated.total,
    jsonb_build_object('receivedAmount', p_received_amount, 'adminNote', p_admin_note)
  )
  returning id, created_at
  into v_action_id, v_action_created_at;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_updated.id,
      'status', v_updated.status,
      'paidAt', v_updated.paid_at,
      'version', v_updated.version
    ),
    'action', jsonb_build_object(
      'id', v_action_id,
      'type', 'MARK_COLLECTED',
      'createdAt', v_action_created_at
    )
  );
end;
$$;

create or replace function public.mark_order_shipped_action(
  p_order_id uuid,
  p_expected_version integer,
  p_actor_type text,
  p_actor_id text,
  p_request_id text,
  p_idempotency_key text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_action_id uuid;
  v_action_created_at timestamptz;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  if v_order.status <> 'PAID' then
    raise exception 'INVALID_STATUS_TRANSITION';
  end if;

  update public.orders
  set
    shipped_at = now(),
    status = 'SHIPPED',
    version = version + 1,
    updated_at = now()
  where id = p_order_id
    and version = p_expected_version
  returning *
  into v_updated;

  if not found then
    raise exception 'VERSION_CONFLICT';
  end if;

  insert into public.order_actions (
    order_id,
    action_type,
    actor_type,
    actor_id,
    request_id,
    idempotency_key,
    from_status,
    to_status,
    version_before,
    version_after,
    payment_method_before,
    payment_method_after,
    payment_reference,
    amount_snapshot,
    metadata
  ) values (
    v_updated.id,
    'MARK_SHIPPED',
    p_actor_type,
    p_actor_id,
    p_request_id,
    p_idempotency_key,
    v_order.status,
    v_updated.status,
    v_order.version,
    v_updated.version,
    v_order.payment_method,
    v_updated.payment_method,
    v_updated.payment_reference,
    v_updated.total,
    jsonb_build_object('adminNote', p_admin_note)
  )
  returning id, created_at
  into v_action_id, v_action_created_at;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_updated.id,
      'status', v_updated.status,
      'shippedAt', v_updated.shipped_at,
      'version', v_updated.version
    ),
    'action', jsonb_build_object(
      'id', v_action_id,
      'type', 'MARK_SHIPPED',
      'createdAt', v_action_created_at
    )
  );
end;
$$;

create or replace function public.cancel_order_action(
  p_order_id uuid,
  p_expected_version integer,
  p_reason_code text,
  p_actor_type text,
  p_actor_id text,
  p_request_id text,
  p_idempotency_key text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_action_id uuid;
  v_action_created_at timestamptz;
begin
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  if v_order.status = 'CANCELLED' or v_order.canceled_at is not null then
    raise exception 'ALREADY_CANCELLED';
  end if;

  if v_order.status not in ('QUOTED', 'PENDING_PAYMENT') then
    raise exception 'ALREADY_COMPLETED';
  end if;

  update public.orders
  set
    canceled_at = now(),
    cancel_reason = p_reason_code,
    status = 'CANCELLED',
    version = version + 1,
    updated_at = now()
  where id = p_order_id
    and version = p_expected_version
  returning *
  into v_updated;

  if not found then
    raise exception 'VERSION_CONFLICT';
  end if;

  insert into public.order_actions (
    order_id,
    action_type,
    actor_type,
    actor_id,
    request_id,
    idempotency_key,
    from_status,
    to_status,
    version_before,
    version_after,
    payment_method_before,
    payment_method_after,
    payment_reference,
    amount_snapshot,
    reason_code,
    metadata
  ) values (
    v_updated.id,
    'CANCELLED',
    p_actor_type,
    p_actor_id,
    p_request_id,
    p_idempotency_key,
    v_order.status,
    v_updated.status,
    v_order.version,
    v_updated.version,
    v_order.payment_method,
    v_updated.payment_method,
    v_updated.payment_reference,
    v_updated.total,
    p_reason_code,
    jsonb_build_object('adminNote', p_admin_note)
  )
  returning id, created_at
  into v_action_id, v_action_created_at;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_updated.id,
      'status', v_updated.status,
      'canceledAt', v_updated.canceled_at,
      'version', v_updated.version
    ),
    'action', jsonb_build_object(
      'id', v_action_id,
      'type', 'CANCELLED',
      'createdAt', v_action_created_at
    )
  );
end;
$$;
