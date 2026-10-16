-- PREPARED ONLY: parent/operator reviews then runs separately. No secrets here.
-- Seed disabled; replace instanceId with the exact approved Worker instance before activation.
-- Conflict causes no overwrite: inspect any existing row rather than reset its evidence.
INSERT INTO public."SchedulerHeartbeat" (id, "schedulerKind", lane, "lastStartedAt", "updatedAt", "monitorState")
VALUES ('independent-outbox-monitor-v1', 'independent-outbox-monitor-v1', 'monitor', now(), now(),
  jsonb_build_object('version', 1, 'enabled', false, 'instanceId', 'REPLACE_WITH_APPROVED_INSTANCE',
    'activatedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expectedLanes', jsonb_build_array('reservation'), 'heartbeat', NULL, 'receivedAt', NULL,
    'activeReasons', jsonb_build_array(), 'sequence', 0, 'events', jsonb_build_array(), 'lastEvaluatedAt', NULL))
ON CONFLICT ("schedulerKind", lane) DO NOTHING;
-- Activation is a separate owner operation after secret configuration/disabled verification.
-- Set enabled=true AND activatedAt=current UTC together; never reset heartbeat/events on an active row.
-- Owner acknowledgement: after inspecting an exact GitHub run and its event sequence(s),
-- stamp only those event ownerAcknowledgedAt values to the actual owner review time.
-- There is intentionally no automatic acknowledgement based on HTTP/job failure/success.
