alter table public.orders alter column payment_method drop not null;

create or replace function public.create_order_quote_action(
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
  p_selected_store_visit_date date default null
)
returns jsonb
language plpgsql
as $$
declare
  v_order public.orders%rowtype;
  v_action_id uuid;
  v_action_created_at timestamptz;
begin
  if p_total < 0 then
    raise exception 'ORDER_TOTAL_INVALID';
  end if;

  insert into public.orders (
    customer_name,
    email,
    phone,
    zip_code,
    prefecture,
    city,
    address,
    building,
    payment_method,
    payment_reference,
    items,
    total,
    store_visit_date,
    hold_expires_at,
    expires_at,
    human_confirmed_at,
    human_confirmed_expires_at,
    human_confirmed_by,
    paid_at,
    shipped_at,
    canceled_at,
    cancel_reason,
    version,
    status
  ) values (
    p_customer_name,
    p_email,
    p_phone,
    p_zip_code,
    p_prefecture,
    p_city,
    p_address,
    nullif(p_building, ''),
    null,
    null,
    coalesce(p_items, '[]'::jsonb),
    p_total,
    null,
    p_hold_expires_at,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    'QUOTED'
  )
  returning *
  into v_order;

  insert into public.human_tokens (
    order_id,
    token_hash,
    expires_at
  ) values (
    v_order.id,
    p_token_hash,
    p_hold_expires_at
  );

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
    'QUOTE_CREATED',
    'user',
    p_actor_id,
    p_request_id,
    p_idempotency_key,
    null,
    'QUOTED',
    null,
    0,
    null,
    null,
    null,
    p_total,
    jsonb_build_object(
      'selectedPaymentMethod', p_selected_payment_method,
      'selectedStoreVisitDate', p_selected_store_visit_date
    )
  )
  returning id, created_at
  into v_action_id, v_action_created_at;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'status', v_order.status,
      'version', v_order.version,
      'total', v_order.total,
      'holdExpiresAt', v_order.hold_expires_at
    ),
    'action', jsonb_build_object(
      'id', v_action_id,
      'type', 'QUOTE_CREATED',
      'createdAt', v_action_created_at
    )
  );
end;
$$;

create or replace function public.save_bank_account_with_history(
  p_id uuid,
  p_bank_name text,
  p_branch_name text,
  p_account_type text,
  p_account_number text,
  p_account_holder text,
  p_account_number_enc text,
  p_account_holder_enc text,
  p_account_number_nonce text,
  p_account_number_auth_tag text,
  p_account_holder_nonce text,
  p_account_holder_auth_tag text,
  p_key_version integer
)
returns jsonb
language plpgsql
as $$
declare
  v_bank_account public.bank_account%rowtype;
begin
  if p_id is null then
    insert into public.bank_account (
      bank_name,
      branch_name,
      account_type,
      account_number,
      account_holder
    ) values (
      p_bank_name,
      p_branch_name,
      p_account_type,
      p_account_number,
      p_account_holder
    )
    returning *
    into v_bank_account;
  else
    update public.bank_account
    set
      bank_name = p_bank_name,
      branch_name = p_branch_name,
      account_type = p_account_type,
      account_number = p_account_number,
      account_holder = p_account_holder
    where id = p_id
    returning *
    into v_bank_account;

    if not found then
      raise exception 'BANK_ACCOUNT_NOT_FOUND';
    end if;
  end if;

  insert into public.bank_account_history (
    bank_account_id,
    action_type,
    changed_by,
    bank_name,
    branch_name,
    account_type,
    account_number_last4,
    account_number_enc,
    account_holder_enc,
    account_number_nonce,
    account_number_auth_tag,
    account_holder_nonce,
    account_holder_auth_tag,
    key_version
  ) values (
    v_bank_account.id,
    'UPDATED',
    'admin',
    v_bank_account.bank_name,
    v_bank_account.branch_name,
    v_bank_account.account_type,
    right(v_bank_account.account_number, 4),
    p_account_number_enc,
    p_account_holder_enc,
    p_account_number_nonce,
    p_account_number_auth_tag,
    p_account_holder_nonce,
    p_account_holder_auth_tag,
    p_key_version
  );

  return to_jsonb(v_bank_account);
end;
$$;

create or replace function public.delete_bank_account_with_history(
  p_id uuid,
  p_account_number_enc text,
  p_account_holder_enc text,
  p_account_number_nonce text,
  p_account_number_auth_tag text,
  p_account_holder_nonce text,
  p_account_holder_auth_tag text,
  p_key_version integer
)
returns jsonb
language plpgsql
as $$
declare
  v_bank_account public.bank_account%rowtype;
begin
  select *
  into v_bank_account
  from public.bank_account
  where id = p_id
  for update;

  if not found then
    return jsonb_build_object('deleted', false);
  end if;

  insert into public.bank_account_history (
    bank_account_id,
    action_type,
    changed_by,
    bank_name,
    branch_name,
    account_type,
    account_number_last4,
    account_number_enc,
    account_holder_enc,
    account_number_nonce,
    account_number_auth_tag,
    account_holder_nonce,
    account_holder_auth_tag,
    key_version
  ) values (
    v_bank_account.id,
    'DELETED',
    'admin',
    v_bank_account.bank_name,
    v_bank_account.branch_name,
    v_bank_account.account_type,
    right(v_bank_account.account_number, 4),
    p_account_number_enc,
    p_account_holder_enc,
    p_account_number_nonce,
    p_account_number_auth_tag,
    p_account_holder_nonce,
    p_account_holder_auth_tag,
    p_key_version
  );

  delete from public.bank_account
  where id = p_id;

  return jsonb_build_object('deleted', true, 'id', p_id);
end;
$$;
