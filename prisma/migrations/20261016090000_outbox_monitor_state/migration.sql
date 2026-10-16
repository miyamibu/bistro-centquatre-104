-- Additive only. Apply BEFORE deploying generated Prisma client selecting this field.
-- No table/role/grant creation; existing rows remain NULL and retain their semantics.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $guard$
BEGIN
  IF to_regclass('public."SchedulerHeartbeat"') IS NULL THEN
    RAISE EXCEPTION 'MONITOR_BASE_TABLE_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'SchedulerHeartbeat' AND column_name = 'monitorState') THEN
    RAISE EXCEPTION 'MONITOR_COLUMN_ALREADY_EXISTS_RECONCILE_MIGRATION';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'SchedulerHeartbeat' AND column_name IN ('schedulerKind', 'lane', 'updatedAt')) <> 3 THEN
    RAISE EXCEPTION 'MONITOR_BASE_COLUMNS_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM public."SchedulerHeartbeat"
      WHERE "schedulerKind" = 'independent-outbox-monitor-v1' OR lane = 'monitor') THEN
    RAISE EXCEPTION 'MONITOR_FIXED_KEY_CONFLICT_REVIEW_REQUIRED';
  END IF;
END
$guard$;
ALTER TABLE public."SchedulerHeartbeat" ADD COLUMN "monitorState" JSONB;
COMMIT;
