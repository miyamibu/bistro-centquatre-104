create or replace function public.execute_atomic_order_mutation(
  p_scope text,
  p_actor_key text,
  p_idempotency_key text,
  p_request_hash text,
  p_operation text,
  p_mutation_args jsonb,
  p_response_context jsonb default '{}'::jsonb,
  p_success_status integer default 200
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  c_claim_lease constant interval := interval '5 minutes';
  v_idempotency public.api_idempotency%rowtype;
  v_claim_token uuid := gen_random_uuid();
  v_mutation jsonb;
  v_response_body jsonb;
  v_order jsonb;
  v_resource_id uuid;
  v_error_code text;
  v_error_status integer;
begin
  if p_scope is null or btrim(p_scope) = ''
     or p_actor_key is null or btrim(p_actor_key) = ''
     or p_idempotency_key is null or btrim(p_idempotency_key) = ''
     or p_request_hash is null or btrim(p_request_hash) = '' then
    raise exception 'IDEMPOTENCY_CLAIM_FAILED';
  end if;

  if p_operation not in (
    'CREATE_QUOTE',
    'CONFIRM_HUMAN',
    'SET_PAYMENT_METHOD',
    'MARK_PAID',
    'MARK_COLLECTED'
  ) then
    raise exception 'INVALID_ORDER_MUTATION';
  end if;

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
      claim_expires_at,
      claim_token
    ) values (
      p_scope,
      p_actor_key,
      p_idempotency_key,
      p_request_hash,
      now() + c_claim_lease,
      v_claim_token
    )
    on conflict (scope, actor_key, idempotency_key) do nothing
    returning * into v_idempotency;

    exit when found;
  end loop;

  if v_idempotency.request_hash <> p_request_hash then
    return jsonb_build_object(
      'status', 409,
      'body', jsonb_build_object(
        'ok', false,
        'error', 'IDEMPOTENCY_CONFLICT',
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

  if v_idempotency.claim_token is distinct from v_claim_token then
    if coalesce(v_idempotency.claim_expires_at, v_idempotency.created_at + c_claim_lease) > now() then
      return jsonb_build_object(
        'status', 409,
        'body', jsonb_build_object(
          'ok', false,
          'error', 'IDEMPOTENCY_IN_PROGRESS',
          'code', 'IDEMPOTENCY_IN_PROGRESS'
        ),
        'replayed', false
      );
    end if;

    -- The atomic RPC cannot leave a durable unfinished claim: any exception
    -- rolls the claim and business mutation back together. An expired row here
    -- therefore came from the legacy client-side claim/finalize path and may
    -- represent a committed mutation with a lost response. Never rerun it.
    return jsonb_build_object(
      'status', 409,
      'body', jsonb_build_object(
        'ok', false,
        'error', 'IDEMPOTENCY_RECOVERY_CONFLICT',
        'code', 'IDEMPOTENCY_RECOVERY_CONFLICT'
      ),
      'replayed', false
    );
  end if;

  begin
    case p_operation
      when 'CREATE_QUOTE' then
        v_mutation := public.create_order_quote_with_receipt_action(
        p_customer_name => p_mutation_args ->> 'customerName',
        p_email => p_mutation_args ->> 'email',
        p_phone => p_mutation_args ->> 'phone',
        p_zip_code => p_mutation_args ->> 'zipCode',
        p_prefecture => p_mutation_args ->> 'prefecture',
        p_city => p_mutation_args ->> 'city',
        p_address => p_mutation_args ->> 'address',
        p_building => p_mutation_args ->> 'building',
        p_items => p_mutation_args -> 'items',
        p_total => (p_mutation_args ->> 'total')::integer,
        p_hold_expires_at => (p_mutation_args ->> 'holdExpiresAt')::timestamptz,
        p_token_hash => p_mutation_args ->> 'humanTokenHash',
        p_actor_id => p_mutation_args ->> 'actorId',
        p_request_id => p_mutation_args ->> 'requestId',
        p_idempotency_key => p_idempotency_key,
        p_selected_payment_method => p_mutation_args ->> 'selectedPaymentMethod',
        p_selected_store_visit_date => nullif(p_mutation_args ->> 'selectedStoreVisitDate', '')::date,
        p_receipt_token_hash => p_mutation_args ->> 'receiptTokenHash'
        );
      when 'CONFIRM_HUMAN' then
        v_mutation := public.confirm_order_human_action(
        p_order_id => (p_mutation_args ->> 'orderId')::uuid,
        p_expected_version => (p_mutation_args ->> 'expectedVersion')::integer,
        p_token_hash => p_mutation_args ->> 'tokenHash',
        p_actor_id => p_mutation_args ->> 'actorId',
        p_request_id => p_mutation_args ->> 'requestId',
        p_idempotency_key => p_idempotency_key
        );
      when 'SET_PAYMENT_METHOD' then
        v_mutation := public.set_order_payment_method_action(
        p_order_id => (p_mutation_args ->> 'orderId')::uuid,
        p_expected_version => (p_mutation_args ->> 'expectedVersion')::integer,
        p_payment_method => p_mutation_args ->> 'paymentMethod',
        p_store_visit_date => nullif(p_mutation_args ->> 'storeVisitDate', '')::date,
        p_expires_at => (p_mutation_args ->> 'expiresAt')::timestamptz,
        p_actor_type => p_mutation_args ->> 'actorType',
        p_actor_id => p_mutation_args ->> 'actorId',
        p_request_id => p_mutation_args ->> 'requestId',
        p_idempotency_key => p_idempotency_key,
        p_token_hash => p_mutation_args ->> 'tokenHash'
        );
      when 'MARK_PAID' then
        v_mutation := public.mark_order_paid_action(
        p_order_id => (p_mutation_args ->> 'orderId')::uuid,
        p_expected_version => (p_mutation_args ->> 'expectedVersion')::integer,
        p_payment_reference => p_mutation_args ->> 'paymentReference',
        p_received_amount => (p_mutation_args ->> 'receivedAmount')::integer,
        p_actor_type => p_mutation_args ->> 'actorType',
        p_actor_id => p_mutation_args ->> 'actorId',
        p_request_id => p_mutation_args ->> 'requestId',
        p_idempotency_key => p_idempotency_key,
        p_admin_note => p_mutation_args ->> 'adminNote'
        );
      when 'MARK_COLLECTED' then
        v_mutation := public.mark_order_collected_action(
        p_order_id => (p_mutation_args ->> 'orderId')::uuid,
        p_expected_version => (p_mutation_args ->> 'expectedVersion')::integer,
        p_received_amount => (p_mutation_args ->> 'receivedAmount')::integer,
        p_actor_type => p_mutation_args ->> 'actorType',
        p_actor_id => p_mutation_args ->> 'actorId',
        p_request_id => p_mutation_args ->> 'requestId',
        p_idempotency_key => p_idempotency_key,
        p_admin_note => p_mutation_args ->> 'adminNote'
        );
    end case;
  exception
    when others then
      v_error_code := case
        when upper(sqlerrm) like '%ORDER_NOT_FOUND%' then 'ORDER_NOT_FOUND'
        when upper(sqlerrm) like '%VERSION_CONFLICT%' then 'VERSION_CONFLICT'
        when upper(sqlerrm) like '%INVALID_STATUS_TRANSITION%' then 'INVALID_STATUS_TRANSITION'
        when upper(sqlerrm) like '%HUMAN_CONFIRMATION_REQUIRED%' then 'HUMAN_CONFIRMATION_REQUIRED'
        when upper(sqlerrm) like '%HUMAN_TOKEN_INVALID%' then 'HUMAN_TOKEN_INVALID'
        when upper(sqlerrm) like '%HUMAN_TOKEN_EXPIRED%' then 'HUMAN_TOKEN_EXPIRED'
        when upper(sqlerrm) like '%PAYMENT_REFERENCE_MISMATCH%' then 'PAYMENT_REFERENCE_MISMATCH'
        when upper(sqlerrm) like '%PAYMENT_AMOUNT_MISMATCH%' then 'PAYMENT_AMOUNT_MISMATCH'
        when upper(sqlerrm) like '%PAYMENT_METHOD_MISMATCH%' then 'PAYMENT_METHOD_MISMATCH'
        when upper(sqlerrm) like '%STORE_VISIT_DATE_REQUIRED%' then 'STORE_VISIT_DATE_REQUIRED'
        when upper(sqlerrm) like '%STORE_VISIT_NOT_BUSINESS_DAY%' then 'STORE_VISIT_NOT_BUSINESS_DAY'
        when upper(sqlerrm) like '%STORE_VISIT_OUT_OF_RANGE%' then 'STORE_VISIT_OUT_OF_RANGE'
        when upper(sqlerrm) like '%INVALID_PAYMENT_METHOD%' then 'INVALID_PAYMENT_METHOD'
        when upper(sqlerrm) like '%ALREADY_CANCELLED%' then 'ALREADY_CANCELLED'
        when upper(sqlerrm) like '%ALREADY_COMPLETED%' then 'ALREADY_COMPLETED'
        else null
      end;

      if v_error_code is null then
        raise;
      end if;

      v_error_status := case
        when v_error_code = 'ORDER_NOT_FOUND' then 404
        when v_error_code like 'HUMAN_%' then 403
        when v_error_code in (
          'STORE_VISIT_DATE_REQUIRED',
          'STORE_VISIT_NOT_BUSINESS_DAY',
          'STORE_VISIT_OUT_OF_RANGE',
          'INVALID_PAYMENT_METHOD'
        ) then 400
        else 409
      end;
      v_response_body := jsonb_build_object(
        'ok', false,
        'error', v_error_code,
        'code', v_error_code
      );

      update public.api_idempotency
      set
        response_status = v_error_status,
        response_body = v_response_body,
        claim_expires_at = null,
        claim_token = null
      where id = v_idempotency.id
        and claim_token = v_claim_token;

      if not found then
        raise exception 'IDEMPOTENCY_FINALIZE_FAILED';
      end if;

      return jsonb_build_object(
        'status', v_error_status,
        'body', v_response_body,
        'replayed', false
      );
  end;

  if v_mutation is null or jsonb_typeof(v_mutation) <> 'object' then
    raise exception 'ATOMIC_ORDER_MUTATION_FAILED';
  end if;

  if p_operation = 'CREATE_QUOTE' then
    v_order := coalesce(v_mutation -> 'order', '{}'::jsonb);
    v_response_body := jsonb_build_object(
      'ok', true,
      'message', coalesce(p_response_context ->> 'message', 'Quote created successfully'),
      'order', v_order || jsonb_build_object(
        'total', (p_mutation_args ->> 'total')::integer,
        'holdExpiresAt', p_mutation_args ->> 'holdExpiresAt',
        'items', p_mutation_args -> 'items'
      ),
      'paymentSetup', jsonb_build_object(
        'orderId', v_order ->> 'id',
        'expectedVersion', coalesce((v_order ->> 'version')::integer, 0),
        'humanToken', p_response_context ->> 'humanToken',
        'receiptToken', p_response_context ->> 'receiptToken',
        'paymentMethod', p_response_context -> 'paymentMethod',
        'storeVisitDate', p_response_context -> 'storeVisitDate',
        'holdExpiresAt', p_mutation_args ->> 'holdExpiresAt'
      ),
      'requestId', p_response_context ->> 'requestId'
    );
  else
    v_response_body := v_mutation || coalesce(p_response_context, '{}'::jsonb);
  end if;

  v_resource_id := nullif(v_mutation #>> '{order,id}', '')::uuid;

  update public.api_idempotency
  set
    response_status = p_success_status,
    response_body = v_response_body,
    resource_id = v_resource_id,
    claim_expires_at = null,
    claim_token = null
  where id = v_idempotency.id
    and claim_token = v_claim_token;

  if not found then
    raise exception 'IDEMPOTENCY_FINALIZE_FAILED';
  end if;

  return jsonb_build_object(
    'status', p_success_status,
    'body', v_response_body,
    'replayed', false
  );
end;
$$;

revoke all on function public.execute_atomic_order_mutation(
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  integer
) from public, anon, authenticated;

grant execute on function public.execute_atomic_order_mutation(
  text,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  integer
) to service_role;

revoke all on function public.create_order_quote_with_receipt_action(
  text, text, text, text, text, text, text, text, jsonb, integer,
  timestamptz, text, text, text, text, text, date, text
) from public, anon, authenticated;
grant execute on function public.create_order_quote_with_receipt_action(
  text, text, text, text, text, text, text, text, jsonb, integer,
  timestamptz, text, text, text, text, text, date, text
) to service_role;

revoke all on function public.confirm_order_human_action(
  uuid, integer, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.confirm_order_human_action(
  uuid, integer, text, text, text, text
) to service_role;

revoke all on function public.set_order_payment_method_action(
  uuid, integer, text, date, timestamptz, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.set_order_payment_method_action(
  uuid, integer, text, date, timestamptz, text, text, text, text, text
) to service_role;

revoke all on function public.mark_order_paid_action(
  uuid, integer, text, integer, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.mark_order_paid_action(
  uuid, integer, text, integer, text, text, text, text, text
) to service_role;

revoke all on function public.mark_order_collected_action(
  uuid, integer, integer, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.mark_order_collected_action(
  uuid, integer, integer, text, text, text, text, text
) to service_role;
