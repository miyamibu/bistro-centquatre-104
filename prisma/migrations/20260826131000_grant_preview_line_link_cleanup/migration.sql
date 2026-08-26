-- Preview uses a separate non-inheriting runtime role. Grant the bounded
-- cleanup function only inside the isolated preview database; never grant the
-- preview role access to the production database.
DO $grant_preview_cleanup$
BEGIN
  IF current_database() = 'bistro_preview'
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bistro_preview_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.cleanup_expired_reservation_line_link_tokens(
      timestamptz,
      integer
    ) TO bistro_preview_runtime;
  END IF;
END
$grant_preview_cleanup$;
