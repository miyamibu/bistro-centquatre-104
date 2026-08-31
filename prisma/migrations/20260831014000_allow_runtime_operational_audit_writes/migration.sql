-- The application runtime records scheduler health and administrator drain
-- audit evidence. Table grants alone do not satisfy RLS, so add narrowly
-- scoped SELECT/INSERT/UPDATE policies without granting DELETE or TRUNCATE.
DO $runtime_operational_audit_policies$
DECLARE
  runtime_role text;
  protected_table text;
  policy_prefix text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['bistro_app_runtime', 'bistro_preview_runtime']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
      FOREACH protected_table IN ARRAY ARRAY['SchedulerHeartbeat', 'OutboxDrainAuditLog']
      LOOP
        policy_prefix := lower(runtime_role || '_' || protected_table);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_prefix || '_select', protected_table);
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO %I USING (true)',
          policy_prefix || '_select',
          protected_table,
          runtime_role
        );

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_prefix || '_insert', protected_table);
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR INSERT TO %I WITH CHECK (true)',
          policy_prefix || '_insert',
          protected_table,
          runtime_role
        );

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_prefix || '_update', protected_table);
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR UPDATE TO %I USING (true) WITH CHECK (true)',
          policy_prefix || '_update',
          protected_table,
          runtime_role
        );
      END LOOP;
    END IF;
  END LOOP;
END
$runtime_operational_audit_policies$;
