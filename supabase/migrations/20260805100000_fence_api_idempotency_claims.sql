alter table public.api_idempotency
  add column if not exists claim_token uuid;

-- Claims written by older application versions did not carry a lease. Give
-- them one full lease from migration time so an in-flight request is not
-- immediately reclaimed during rollout.
update public.api_idempotency
set claim_expires_at = greatest(created_at + interval '5 minutes', now() + interval '5 minutes')
where response_status is null
  and response_body is null
  and claim_expires_at is null;
