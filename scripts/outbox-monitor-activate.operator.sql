-- PREPARED ONLY. Replace the instance literal after reviewing exact Worker config.
-- This accepts ONLY an unused disabled row; it cannot reset an existing monitor incident.
SET lock_timeout = '3s';
SET statement_timeout = '15s';
UPDATE public."SchedulerHeartbeat"
SET "monitorState" = jsonb_set(jsonb_set("monitorState", '{enabled}', 'true'::jsonb), '{activatedAt}',
      to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
    "updatedAt" = now()
WHERE "schedulerKind" = 'independent-outbox-monitor-v1' AND lane = 'monitor'
  AND "monitorState"->>'instanceId' = 'REPLACE_WITH_APPROVED_INSTANCE'
  AND "monitorState"->>'instanceId' <> 'REPLACE_WITH_APPROVED_INSTANCE'
  AND "monitorState"->>'enabled' = 'false'
  AND "monitorState"->'heartbeat' = 'null'::jsonb
  AND "monitorState"->'events' = '[]'::jsonb
  AND "monitorState"->>'sequence' = '0';
-- Intentionally updates zero rows until BOTH instance literals are reviewed:
-- replace ONLY the equality literal; retain the inequality sentinel guard.
-- Require UPDATE 1; otherwise stop and inspect. Enable GitHub variable at activation.
