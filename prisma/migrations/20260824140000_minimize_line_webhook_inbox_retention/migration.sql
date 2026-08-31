-- Bounded retention for already processed LINE webhook receipts.
-- The runtime role keeps no direct DELETE privilege on the inbox table.

CREATE OR REPLACE FUNCTION public.cleanup_processed_line_webhook_inbox(
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
  IF retention_before IS NULL OR max_rows IS NULL OR max_rows < 1 OR max_rows > 200 THEN
    RAISE EXCEPTION 'invalid LINE webhook cleanup bounds';
  END IF;

  WITH candidates AS (
    SELECT inbox."id"
    FROM public."LineWebhookInbox" AS inbox
    WHERE inbox."status" = 'PROCESSED'::public."LineWebhookInboxStatus"
      AND inbox."processedAt" < retention_before
    ORDER BY inbox."processedAt" ASC
    LIMIT max_rows
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public."LineWebhookInbox" AS inbox
  USING candidates
  WHERE inbox."id" = candidates."id";

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_processed_line_webhook_inbox(timestamptz, integer)
FROM PUBLIC;

DO $grant_runtime_cleanup$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bistro_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.cleanup_processed_line_webhook_inbox(timestamptz, integer)
    TO bistro_app_runtime;
  END IF;
END
$grant_runtime_cleanup$;
