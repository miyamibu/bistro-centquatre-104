alter table public.api_idempotency
  add column if not exists claim_expires_at timestamptz;

update public.api_idempotency
set claim_expires_at = created_at + interval '5 minutes'
where response_status is null
  and response_body is null
  and claim_expires_at is null;

create index if not exists idx_api_idempotency_unfinalized_claim
  on public.api_idempotency (claim_expires_at)
  where response_status is null or response_body is null;

create or replace function public.execute_terminal_order_action(
  p_scope text,
  p_actor_key text,
  p_idempotency_key text,
  p_request_hash text,
  p_order_id uuid,
  p_expected_version integer,
  p_action text,
  p_reason_code text,
  p_actor_type text,
  p_actor_id text,
  p_request_id text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
as $$
declare
  c_claim_lease interval := interval '5 minutes';
  v_idempotency public.api_idempotency%rowtype;
  v_order public.orders%rowtype;
  v_existing_action public.order_actions%rowtype;
  v_action_result jsonb;
  v_body jsonb;
  v_status integer;
  v_is_new_claim boolean := false;
  v_reconciled boolean := false;
  v_action_type text;
  v_error_message text;
  v_error_code text;
begin
  if p_action not in ('MARK_SHIPPED', 'CANCEL') then
    return jsonb_build_object(
      'status', 400,
      'body', jsonb_build_object(
        'ok', false,
        'error', 'INVALID_TERMINAL_ACTION',
        'code', 'INVALID_TERMINAL_ACTION'
      ),
      'replayed', false
    );
  end if;

  if p_action = 'CANCEL' and nullif(btrim(coalesce(p_reason_code, '')), '') is null then
    return jsonb_build_object(
      'status', 400,
      'body', jsonb_build_object(
        'ok', false,
        'error', 'CANCEL_REASON_REQUIRED',
        'code', 'CANCEL_REASON_REQUIRED'
      ),
      'replayed', false
    );
  end if;

  v_action_type := case p_action
    when 'MARK_SHIPPED' then 'MARK_SHIPPED'
    else 'CANCELLED'
  end;

  loop
    select *
    into v_idempotency
    from public.api_idempotency
    where scope = p_scope
      and actor_key = p_actor_key
      and idempotency_key = p_idempotency_key
    for update;

    exit when found;

    insert into public.api_idempotency (
      scope,
      actor_key,
      idempotency_key,
      request_hash,
      claim_expires_at
    ) values (
      p_scope,
      p_actor_key,
      p_idempotency_key,
      p_request_hash,
      now() + c_claim_lease
    )
    on conflict (scope, actor_key, idempotency_key) do nothing;

    if found then
      v_is_new_claim := true;
    end if;
  end loop;

  if v_idempotency.request_hash <> p_request_hash then
    return jsonb_build_object(
      'status', 409,
      'body', jsonb_build_object(
        'ok', false,
        'error', '同じキーで別の内容は送信できません',
        'code', 'IDEMPOTENCY_CONFLICT'
      ),
      'replayed', false
    );
  end if;

  if v_idempotency.response_status is not null
     and v_idempotency.response_body is not null then
    return jsonb_build_object(
      'status', v_idempotency.response_status,
      'body', v_idempotency.response_body,
      'replayed', true
    );
  end if;

  if not v_is_new_claim
     and coalesce(v_idempotency.claim_expires_at, v_idempotency.created_at + c_claim_lease) > now() then
    return jsonb_build_object(
      'status', 409,
      'body', jsonb_build_object(
        'ok', false,
        'error', '同じキーの処理が進行中です',
        'code', 'IDEMPOTENCY_IN_PROGRESS'
      ),
      'replayed', false
    );
  end if;

  update public.api_idempotency
  set claim_expires_at = now() + c_claim_lease
  where id = v_idempotency.id;

  begin
    select *
    into v_existing_action
    from public.order_actions
    where order_id = p_order_id
      and idempotency_key = p_idempotency_key
      and action_type = v_action_type
    order by created_at desc
    limit 1;

    if found then
      select *
      into v_order
      from public.orders
      where id = p_order_id
      for update;

      if not found then
        raise exception 'ORDER_NOT_FOUND';
      end if;

      if (p_action = 'MARK_SHIPPED' and v_order.status <> 'SHIPPED')
         or (p_action = 'CANCEL' and v_order.status <> 'CANCELLED') then
        raise exception 'IDEMPOTENCY_RECOVERY_CONFLICT';
      end if;

      v_reconciled := true;
      v_body := case p_action
        when 'MARK_SHIPPED' then jsonb_build_object(
          'ok', true,
          'order', jsonb_build_object(
            'id', v_order.id,
            'status', v_order.status,
            'shippedAt', v_order.shipped_at,
            'version', v_order.version
          ),
          'action', jsonb_build_object(
            'id', v_existing_action.id,
            'type', 'MARK_SHIPPED',
            'createdAt', v_existing_action.created_at
          )
        )
        else jsonb_build_object(
          'ok', true,
          'order', jsonb_build_object(
            'id', v_order.id,
            'status', v_order.status,
            'canceledAt', v_order.canceled_at,
            'version', v_order.version
          ),
          'action', jsonb_build_object(
            'id', v_existing_action.id,
            'type', 'CANCELLED',
            'createdAt', v_existing_action.created_at
          )
        )
      end;
    else
      if p_action = 'MARK_SHIPPED' then
        v_action_result := public.mark_order_shipped_action(
          p_order_id,
          p_expected_version,
          p_actor_type,
          p_actor_id,
          p_request_id,
          p_idempotency_key,
          p_admin_note
        );
      else
        v_action_result := public.cancel_order_action(
          p_order_id,
          p_expected_version,
          p_reason_code,
          p_actor_type,
          p_actor_id,
          p_request_id,
          p_idempotency_key,
          p_admin_note
        );
      end if;

      select *
      into v_order
      from public.orders
      where id = p_order_id
      for update;

      if not found then
        raise exception 'ORDER_NOT_FOUND';
      end if;

      if (p_action = 'MARK_SHIPPED' and v_order.status <> 'SHIPPED')
         or (p_action = 'CANCEL' and v_order.status <> 'CANCELLED') then
        raise exception 'TERMINAL_ORDER_ACTION_FAILED';
      end if;

      v_body := v_action_result;
    end if;

    insert into public.order_history (
      id,
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
      status,
      paid_at,
      shipped_at,
      canceled_at,
      cancel_reason,
      version,
      created_at,
      deleted_at
    ) values (
      v_order.id,
      v_order.customer_name,
      v_order.email,
      v_order.phone,
      v_order.zip_code,
      v_order.prefecture,
      v_order.city,
      v_order.address,
      v_order.building,
      v_order.payment_method,
      v_order.payment_reference,
      v_order.items,
      v_order.total,
      v_order.store_visit_date,
      v_order.status,
      v_order.paid_at,
      v_order.shipped_at,
      v_order.canceled_at,
      v_order.cancel_reason,
      v_order.version,
      v_order.created_at,
      case
        when v_order.status = 'SHIPPED' then coalesce(v_order.shipped_at, now())
        else coalesce(v_order.canceled_at, now())
      end
    )
    on conflict (id) do nothing;

    v_status := 200;
  exception
    when others then
      get stacked diagnostics v_error_message = message_text;

      v_error_code := case
        when upper(v_error_message) like '%ORDER_NOT_FOUND%' then 'ORDER_NOT_FOUND'
        when upper(v_error_message) like '%VERSION_CONFLICT%' then 'VERSION_CONFLICT'
        when upper(v_error_message) like '%INVALID_STATUS_TRANSITION%' then 'INVALID_STATUS_TRANSITION'
        when upper(v_error_message) like '%ALREADY_CANCELLED%' then 'ALREADY_CANCELLED'
        when upper(v_error_message) like '%ALREADY_COMPLETED%' then 'ALREADY_COMPLETED'
        when upper(v_error_message) like '%IDEMPOTENCY_RECOVERY_CONFLICT%' then 'IDEMPOTENCY_RECOVERY_CONFLICT'
        else case p_action
          when 'MARK_SHIPPED' then 'MARK_SHIPPED_FAILED'
          else 'CANCEL_ORDER_FAILED'
        end
      end;

      v_status := case
        when v_error_code = 'ORDER_NOT_FOUND' then 404
        when v_error_code in (
          'VERSION_CONFLICT',
          'INVALID_STATUS_TRANSITION',
          'ALREADY_CANCELLED',
          'ALREADY_COMPLETED',
          'IDEMPOTENCY_RECOVERY_CONFLICT'
        ) then 409
        else 500
      end;

      if v_status >= 500 then
        v_body := jsonb_build_object(
          'ok', false,
          'error', 'Internal server error',
          'code', 'TERMINAL_ORDER_ACTION_FAILED'
        );
      else
        v_body := jsonb_build_object(
          'ok', false,
          'error', v_error_message,
          'code', v_error_code
        );
      end if;

      if v_reconciled and v_error_code <> 'IDEMPOTENCY_RECOVERY_CONFLICT' then
        update public.api_idempotency
        set claim_expires_at = now() - interval '1 second'
        where id = v_idempotency.id;

        return jsonb_build_object(
          'status', 500,
          'body', jsonb_build_object(
            'ok', false,
            'error', 'Internal server error',
            'code', 'TERMINAL_ORDER_ACTION_FAILED'
          ),
          'replayed', false,
          'reconciled', true
        );
      end if;
  end;

  update public.api_idempotency
  set
    response_status = v_status,
    response_body = v_body,
    resource_id = case when v_status = 200 then p_order_id::text else null end,
    claim_expires_at = null
  where id = v_idempotency.id;

  if not found then
    raise exception 'IDEMPOTENCY_FINALIZE_FAILED';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'body', v_body,
    'replayed', false,
    'reconciled', v_reconciled
  );
end;
$$;

revoke execute on function public.execute_terminal_order_action(
  text,
  text,
  text,
  text,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.execute_terminal_order_action(
  text,
  text,
  text,
  text,
  uuid,
  integer,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;
