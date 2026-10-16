-- PREPARED ONLY, executed by owner AFTER inspecting the exact GitHub run and events.
-- Fill reviewed ids explicitly. Empty list is inert. This records OWNER REVIEW,
-- not email delivery or a GitHub notification receipt, and does not clear active reasons.
SET lock_timeout = '3s';
SET statement_timeout = '15s';
WITH reviewed AS (SELECT ARRAY[]::bigint[] AS ids)
UPDATE public."SchedulerHeartbeat" AS h
SET "monitorState" = jsonb_set(h."monitorState", '{events}', (
      SELECT COALESCE(jsonb_agg(CASE WHEN (e->>'sequence')::bigint = ANY(reviewed.ids)
          AND e->'ownerAcknowledgedAt' = 'null'::jsonb
        THEN jsonb_set(e, '{ownerAcknowledgedAt}', to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
        ELSE e END ORDER BY ordinal), '[]'::jsonb)
      FROM jsonb_array_elements(h."monitorState"->'events') WITH ORDINALITY AS event(e, ordinal))),
    "updatedAt" = now()
FROM reviewed
WHERE h."schedulerKind" = 'independent-outbox-monitor-v1' AND h.lane = 'monitor'
  AND cardinality(reviewed.ids) > 0;
-- Next evaluation compacts only owner-acknowledged events; capture reviewed evidence before running.
