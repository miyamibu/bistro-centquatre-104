create table if not exists public.order_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  type text not null check (type in ('ORDER_CONFIRMATION')),
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, order_id, idempotency_key)
);

create index if not exists idx_order_notification_outbox_status_created
  on public.order_notification_outbox (status, created_at);

create index if not exists idx_order_notification_outbox_order
  on public.order_notification_outbox (order_id, created_at desc);

drop trigger if exists trg_order_notification_outbox_set_updated_at on public.order_notification_outbox;
create trigger trg_order_notification_outbox_set_updated_at
before update on public.order_notification_outbox
for each row execute function public.set_updated_at();

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
  v_outbox_id uuid;
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

  insert into public.order_notification_outbox (
    order_id,
    type,
    status,
    idempotency_key,
    payload
  ) values (
    v_updated.id,
    'ORDER_CONFIRMATION',
    'PENDING',
    p_idempotency_key,
    jsonb_build_object(
      'orderVersion', v_updated.version,
      'paymentMethod', v_updated.payment_method,
      'paymentReferenceIssued', v_payment_reference is not null
    )
  )
  on conflict (type, order_id, idempotency_key) do update
  set
    payload = excluded.payload,
    status = case
      when public.order_notification_outbox.status = 'SENT' then public.order_notification_outbox.status
      else 'PENDING'
    end,
    error_code = null
  returning id
  into v_outbox_id;

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
    ),
    'notification', jsonb_build_object(
      'queued', true,
      'outboxId', v_outbox_id,
      'type', 'ORDER_CONFIRMATION'
    )
  );
end;
$$;
