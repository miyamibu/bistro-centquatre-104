-- Minimize operator/customer network metadata and bound ephemeral security state.
-- The application writes purpose-separated HMACs after this migration; any
-- historical raw address is removed instead of being retained indefinitely.

UPDATE public."ReservationStatusAuditLog"
SET "ipAddress" = NULL
WHERE "ipAddress" IS NOT NULL
  AND "ipAddress" !~ '^[0-9a-f]{64}$';

UPDATE public."ReservationCorrectionAuditLog"
SET "ipAddress" = NULL
WHERE "ipAddress" IS NOT NULL
  AND "ipAddress" !~ '^[0-9a-f]{64}$';

UPDATE public."PrivateBlockAuditLog"
SET "ipAddress" = NULL
WHERE "ipAddress" IS NOT NULL
  AND "ipAddress" !~ '^[0-9a-f]{64}$';

UPDATE public."BusinessDayAuditLog"
SET "ipAddress" = NULL
WHERE "ipAddress" IS NOT NULL
  AND "ipAddress" !~ '^[0-9a-f]{64}$';

CREATE OR REPLACE FUNCTION public.cleanup_ephemeral_reservation_security_state(
  rate_limit_before timestamptz,
  idempotency_before timestamptz,
  max_rows_per_table integer
)
RETURNS TABLE(deleted_rate_limit_count integer, deleted_idempotency_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF rate_limit_before IS NULL
    OR idempotency_before IS NULL
    OR max_rows_per_table IS NULL
    OR max_rows_per_table < 1
    OR max_rows_per_table > 500
  THEN
    RAISE EXCEPTION 'invalid ephemeral reservation cleanup bounds';
  END IF;

  WITH candidates AS (
    SELECT event."id"
    FROM public."ReservationRateLimitEvent" AS event
    WHERE event."createdAt" < rate_limit_before
    ORDER BY event."createdAt" ASC
    LIMIT max_rows_per_table
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."ReservationRateLimitEvent" AS event
    USING candidates
    WHERE event."id" = candidates."id"
    RETURNING 1
  )
  SELECT count(*)::integer INTO deleted_rate_limit_count FROM deleted;

  WITH candidates AS (
    SELECT record."id"
    FROM public."ReservationIdempotency" AS record
    WHERE record."createdAt" < idempotency_before
      AND record."responseStatus" IS NOT NULL
      AND record."responseBody" IS NOT NULL
    ORDER BY record."createdAt" ASC
    LIMIT max_rows_per_table
    FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."ReservationIdempotency" AS record
    USING candidates
    WHERE record."id" = candidates."id"
    RETURNING 1
  )
  SELECT count(*)::integer INTO deleted_idempotency_count FROM deleted;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_ephemeral_reservation_security_state(
  timestamptz,
  timestamptz,
  integer
) FROM PUBLIC;

DO $cleanup_grants$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.cleanup_ephemeral_reservation_security_state(timestamptz, timestamptz, integer) FROM %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bistro_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.cleanup_ephemeral_reservation_security_state(
      timestamptz,
      timestamptz,
      integer
    ) TO bistro_app_runtime;
  END IF;

  IF current_database() = 'bistro_preview'
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bistro_preview_runtime')
  THEN
    GRANT EXECUTE ON FUNCTION public.cleanup_ephemeral_reservation_security_state(
      timestamptz,
      timestamptz,
      integer
    ) TO bistro_preview_runtime;
  END IF;
END
$cleanup_grants$;
