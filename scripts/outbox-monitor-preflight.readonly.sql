-- Read-only operator preflight, BEFORE migration. No customer fields.
SELECT current_database() AS database_name,
       to_regclass('public."SchedulerHeartbeat"') IS NOT NULL AS table_exists;
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'SchedulerHeartbeat'
  AND column_name IN ('schedulerKind', 'lane', 'monitorState');
SELECT "schedulerKind", lane, count(*) AS row_count
FROM public."SchedulerHeartbeat"
WHERE "schedulerKind" = 'independent-outbox-monitor-v1' OR lane = 'monitor'
GROUP BY "schedulerKind", lane;
-- AFTER migration, verify one nullable jsonb column before deploy.
-- SELECT "monitorState" IS NULL AS absent_state FROM public."SchedulerHeartbeat"
-- WHERE "schedulerKind" = 'independent-outbox-monitor-v1' AND lane = 'monitor';
-- Run using the actual application connection role, without printing connection strings.
-- ACL is insufficient on its own when RLS is active; owner/bypass or an existing
-- applicable policy must already permit the fixed monitor row. No grants prepared.
SELECT current_user AS observed_role,
       has_table_privilege(current_user, 'public."SchedulerHeartbeat"', 'SELECT') AS can_select,
       has_table_privilege(current_user, 'public."SchedulerHeartbeat"', 'UPDATE') AS can_update,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       c.relowner = r.oid AS current_role_is_table_owner, r.rolbypassrls, r.rolsuper
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles r ON r.rolname = current_user
WHERE n.nspname = 'public' AND c.relname = 'SchedulerHeartbeat';
SELECT policyname, permissive, roles, cmd
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'SchedulerHeartbeat';
