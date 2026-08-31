-- Bounded cleanup for expired one-time reservation-to-LINE link tokens.
-- The runtime role keeps no direct DELETE privilege on the token table.

CREATE OR REPLACE FUNCTION public.cleanup_expired_reservation_line_link_tokens(
  retention_before timestamptz,
  max_rows integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  deleted_count integer;
BEGIN
  IF retention_before IS NULL OR max_rows IS NULL OR max_rows < 1 OR max_rows > 500 THEN
    RAISE EXCEPTION 'invalid reservation LINE link token cleanup bounds';
  END IF;

  WITH candidates AS (
    SELECT token."id"
    FROM public."ReservationLineLinkToken" AS token
    WHERE token."expiresAt" < retention_before
    ORDER BY token."expiresAt" ASC
    LIMIT max_rows
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public."ReservationLineLinkToken" AS token
  USING candidates
  WHERE token."id" = candidates."id";

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_expired_reservation_line_link_tokens(timestamptz, integer)
FROM PUBLIC;
DO $revoke_non_runtime_cleanup$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.cleanup_expired_reservation_line_link_tokens(timestamptz, integer) FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$revoke_non_runtime_cleanup$;

DO $grant_runtime_cleanup$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bistro_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.cleanup_expired_reservation_line_link_tokens(timestamptz, integer)
    TO bistro_app_runtime;
  END IF;
END
$grant_runtime_cleanup$;
