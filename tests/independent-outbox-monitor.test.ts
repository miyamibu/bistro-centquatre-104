import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createMonitorHandler, evaluate, validateHeartbeat, validateState, type MonitorState, type MonitorStore } from '../src/lib/independent-outbox-monitor';
const now = Date.parse('2026-10-16T10:00:00.000Z');
const iso = (offset = 0) => new Date(now + offset).toISOString();
const initial = (): MonitorState => ({ version: 1, enabled: true, instanceId: 'reservation-worker', activatedAt: iso(-1_000), expectedLanes: ['reservation'], heartbeat: null, receivedAt: null, activeReasons: [], sequence: 0, events: [], lastEvaluatedAt: null });
const heartbeat = () => ({ instanceId: 'reservation-worker', completedAt: iso(), healthy: true, reasons: [], claimed: 0, accepted: 0, retryNotSent: 0, unknown: 0, unsafe: 0, lanes: [{ lane: 'reservation' as const, ok: true, pending: 0, due: 0, inflight: 0, unknown: 0, reconcile: 0, terminal: 0, oldestPendingSeconds: 0 }] });
const ingest = 'i'.repeat(32), cron = 'c'.repeat(32);
function fixture(options: { failCommit?: boolean; disabled?: boolean; activationAgeMs?: number } = {}) {
  let value = initial(); value.enabled = !options.disabled;
  if (options.activationAgeMs !== undefined) value.activatedAt = iso(-options.activationAgeMs);
  let saves = 0;
  let queue = Promise.resolve();
  const store: MonitorStore = { transaction(operation) {
    const result = queue.then(async () => {
      let draft = structuredClone(value);
      const result = await operation(draft, async next => { draft = next; saves++; });
      if (options.failCommit) throw new Error('private database error');
      value = draft;
      return result;
    });
    queue = result.then(() => {}, () => {});
    return result;
  } };
  const handler = createMonitorHandler({ store, clock: () => now, secrets: () => ({ ingest, evaluate: cron }) });
  const request = (action = 'heartbeat', body: unknown = heartbeat(), token = action === 'heartbeat' ? ingest : cron) => new Request('https://example.test/api/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: action === 'heartbeat' ? JSON.stringify(body) : undefined });
  return { handler, request, state: () => value, saves: () => saves };
}

test('first heartbeat grace is bounded; evaluates without any Worker input', () => {
  const state = initial(); state.activatedAt = iso(-900_001);
  assert.deepEqual(evaluate(state, now).reasons, ['FIRST_HEARTBEAT_MISSING']);
  state.activatedAt = iso(-900_000); assert.deepEqual(evaluate(state, now).reasons, []);
});
test('strict envelope rejects extra keys, PII, wrong instance, type and unbounded counters', () => {
  for (const change of [{ email: 'forbidden' }, { instanceId: 'other' }, { claimed: 1e10 }, { accepted: -1 }, { unknown: 0.5 }, { healthy: 'true' }, { reasons: ['arbitrary customer text'] }]) {
    assert.throws(() => validateHeartbeat({ ...heartbeat(), ...change }, initial(), now));
  }
});
test('lane topology and nested fields are fixed', () => {
  for (const lanes of [[], [heartbeat().lanes[0], heartbeat().lanes[0]], [{ ...heartbeat().lanes[0], recipient: 'forbidden' }], [{ ...heartbeat().lanes[0], ok: 1 }], [{ ...heartbeat().lanes[0], pending: null }]]) {
    assert.throws(() => validateHeartbeat({ ...heartbeat(), lanes }, initial(), now));
  }
});
test('stale/future/preactivation/replay rejected with exact time bounds', () => {
  const state = initial(); state.activatedAt = iso(-2_000_000);
  for (const offset of [-900_001, 30_001]) assert.throws(() => validateHeartbeat({ ...heartbeat(), completedAt: iso(offset) }, state, now));
  validateHeartbeat({ ...heartbeat(), completedAt: iso(-900_000) }, state, now);
  validateHeartbeat({ ...heartbeat(), completedAt: iso(30_000) }, state, now);
  assert.throws(() => validateHeartbeat({ ...heartbeat(), completedAt: iso(-1_001) }, initial(), now));
  state.heartbeat = heartbeat(); assert.throws(() => validateHeartbeat(heartbeat(), state, now), /HEARTBEAT_REPLAY/);
});
test('independent next heartbeat and completedAt aging detected', () => {
  const state = initial(); state.heartbeat = heartbeat(); state.receivedAt = iso();
  const result = evaluate(state, now + 900_001);
  assert.deepEqual(result.reasons, ['HEARTBEAT_MISSING', 'HEARTBEAT_STALE']);
});
test('detects unhealthy storage/unknown/reconcile/dead-letter/backlog/unsafe counters', () => {
  const state = initial(); state.heartbeat = heartbeat(); state.receivedAt = iso();
  Object.assign(state.heartbeat, { healthy: false, unknown: 1, unsafe: 1 });
  Object.assign(state.heartbeat.lanes[0], { ok: false, reconcile: 1, terminal: 1, oldestPendingSeconds: 901 });
  assert.deepEqual(evaluate(state, now).reasons, ['BACKLOG_OVERDUE', 'DEAD_LETTER', 'LANE_STORAGE_FAILED', 'OUTCOME_UNKNOWN', 'RECONCILE_REQUIRED', 'UNSAFE_TRANSITION', 'WORKER_UNHEALTHY']);
});
test('per-reason alert dedup, durable recovery, recurrence; delivery remains unacknowledged', () => {
  const state = initial(); state.activatedAt = iso(-900_001);
  const alert = evaluate(state, now); const same = evaluate(alert.state, now + 1);
  assert.equal(same.state.sequence, 1); assert.equal(same.pending, 1);
  same.state.heartbeat = heartbeat(); same.state.receivedAt = iso();
  const recovery = evaluate(same.state, now);
  assert.equal(recovery.pending, 2); assert.equal(recovery.state.events[1].kind, 'recovery');
  assert.ok(recovery.state.events.every(e => e.ownerAcknowledgedAt === null));
  const recurring = evaluate(recovery.state, now + 900_001);
  assert.equal(recurring.state.sequence, 4);
});
test('queue capacity fails closed and never discards unacknowledged evidence', () => {
  const state = initial(); state.activatedAt = iso(-900_001); state.sequence = 64;
  state.events = Array.from({ length: 64 }, (_, i) => ({ sequence: i + 1, reason: 'FIRST_HEARTBEAT_MISSING', kind: 'alert', at: iso(), ownerAcknowledgedAt: null }));
  assert.throws(() => evaluate(state, now), /MONITOR_EVENT_CAPACITY/); assert.equal(state.events.length, 64);
});
test('malformed persistent state fails closed; receipt cannot be forged into future', () => {
  assert.throws(() => validateState(null, now));
  const state = initial(); state.heartbeat = heartbeat(); state.receivedAt = iso(1);
  assert.throws(() => validateState(state, now), /MONITOR_STATE_INVALID/);
});
test('ingress durable receipt assigned by server and success only after commit', async () => {
  const f = fixture(); const response = await f.handler(f.request(), 'heartbeat');
  assert.equal(response.status, 200); assert.equal(f.state().receivedAt, iso()); assert.equal(f.saves(), 1);
  assert.deepEqual(await response.json(), { ok: true, durable: true });
  const evaluated = await f.handler(f.request('evaluate'), 'evaluate');
  const ready = await evaluated.json();
  assert.equal(ready.healthy, true); assert.equal(ready.heartbeatReceived, true); assert.equal(ready.readiness, 'HEALTHY');
  const broken = fixture({ failCommit: true });
  assert.equal((await broken.handler(broken.request(), 'heartbeat')).status, 503);
  assert.equal(broken.state().heartbeat, null);
});
test('auth distinguishes dedicated Worker and GitHub secrets; unauthorized has zero writes', async () => {
  const f = fixture();
  assert.equal((await f.handler(f.request('heartbeat', heartbeat(), cron), 'heartbeat')).status, 401);
  assert.equal((await f.handler(f.request('evaluate', undefined, ingest), 'evaluate')).status, 401);
  assert.equal(f.saves(), 0);
  const handler = createMonitorHandler({ store: { transaction: async () => { throw new Error('must not access'); } }, secrets: () => ({ ingest, evaluate: ingest }) });
  assert.equal((await handler(f.request(), 'heartbeat')).status, 503);
  for (const evaluator of ['x'.repeat(31), 'x'.repeat(513)]) {
    const invalid = createMonitorHandler({ store: { transaction: async () => { throw new Error('must not access'); } }, secrets: () => ({ ingest, evaluate: evaluator }) });
    assert.equal((await invalid(f.request(), 'heartbeat')).status, 503);
  }
});
test('disabled default does not save or accept heartbeats', async () => {
  const f = fixture({ disabled: true });
  assert.equal((await f.handler(f.request(), 'heartbeat')).status, 503); assert.equal(f.saves(), 0);
});
test('body size/content type/invalid JSON rejects; server never echoes raw payload/error', async () => {
  const f = fixture();
  for (const [body, content, status] of [['x'.repeat(8193), 'application/json', 413], ['{', 'application/json', 400], ['{}', 'text/plain', 415]] as const) {
    const request = new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer ' + ingest, 'content-type': content }, body });
    const response = await f.handler(request, 'heartbeat'); assert.equal(response.status, status); assert.deepEqual(Object.keys(await response.json()).sort(), ['code', 'ok']);
  }
  assert.equal(f.saves(), 0);
});
test('concurrent identical ingests serialize into one commit and one replay rejection', async () => {
  const f = fixture(); const responses = await Promise.all([f.handler(f.request(), 'heartbeat'), f.handler(f.request(), 'heartbeat')]);
  assert.deepEqual(responses.map(r => r.status), [200, 409]); assert.equal(f.saves(), 1);
});
test('bounded evaluator reports missing notification configuration without claiming delivery', async () => {
  const f = fixture(); const response = await f.handler(f.request('evaluate'), 'evaluate');
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, healthy: null, heartbeatReceived: false, readiness: 'WAITING_FOR_FIRST_HEARTBEAT', reasons: [], pendingOwnerAcknowledgements: 0, sequence: 0, pendingEvents: [], notificationDelivery: { status: 'NOT_CONFIGURED', throughSequence: 0, pendingCount: 0, batchId: null, providerAcceptedAt: null, code: 'CONFIGURATION_INVALID', inboxReceipt: 'UNVERIFIED', ownerAcknowledgement: 'SEPARATE' } });
  const late = fixture({ activationAgeMs: 900_001 });
  const missing = await (await late.handler(late.request('evaluate'), 'evaluate')).json();
  assert.equal(missing.healthy, false); assert.equal(missing.heartbeatReceived, false); assert.equal(missing.readiness, 'UNHEALTHY');
  assert.deepEqual(missing.reasons, ['FIRST_HEARTBEAT_MISSING']);
});

test('actual reporter fractional backlog age is accepted and unhealthy ingestion records event before next evaluation', async () => {
  const f = fixture(); const payload = heartbeat();
  payload.lanes[0].oldestPendingSeconds = 900.125;
  const response = await f.handler(f.request('heartbeat', payload), 'heartbeat');
  assert.equal(response.status, 200);
  assert.deepEqual(f.state().activeReasons, ['BACKLOG_OVERDUE']);
  assert.equal(f.state().events[0].reason, 'BACKLOG_OVERDUE');
  const evaluated = await f.handler(f.request('evaluate'), 'evaluate');
  const result = await evaluated.json();
  assert.equal(result.heartbeatReceived, true); assert.equal(result.readiness, 'UNHEALTHY');
  assert.deepEqual(result.pendingEvents, [{ sequence: 1, reason: 'BACKLOG_OVERDUE', kind: 'alert' }]);
});

test('actor cutover retains operational alerts until genuine new actor measurements', async () => {
  const { createHash } = await import('node:crypto');
  const before = initial(); before.instanceId = 'synthetic-canary'; before.activatedAt = iso(-1_800_000);
  before.heartbeat = { ...heartbeat(), instanceId: before.instanceId, completedAt: iso(-1_000_000), healthy: false };
  Object.assign(before.heartbeat.lanes[0], { terminal: 63, oldestPendingSeconds: 901 });
  before.receivedAt = iso(-1_000_000);
  before.activeReasons = ['BACKLOG_OVERDUE', 'DEAD_LETTER', 'WORKER_UNHEALTHY', 'HEARTBEAT_MISSING', 'HEARTBEAT_STALE'];
  before.sequence = before.activeReasons.length;
  before.events = before.activeReasons.map((reason, index) => ({ sequence: index + 1, reason, kind: 'alert', at: iso(-20_000), ownerAcknowledgedAt: index === 0 ? iso(-17_000) : null }));
  const event = before.events[1];
  const tuples = [{ sequence: event.sequence, reason: event.reason, kind: event.kind, at: event.at }];
  const batchId = createHash('sha256').update(JSON.stringify({ version: 1, instanceId: before.instanceId, events: tuples })).digest('hex');
  before.notificationDelivery = { version: 1, throughSequence: event.sequence, batches: [{
    batchId, instanceId: before.instanceId, events: tuples, idempotencyKey: 'outbox-monitor/v1/' + batchId,
    requestSHA256: 'a'.repeat(64), firstAttemptAt: iso(-19_000), lastAttemptAt: iso(-19_000), attempt: 1,
    state: 'ACCEPTED', leaseUntil: null, providerId: 'synthetic-provider-receipt', acceptedAt: iso(-18_000), code: null,
  }] };
  validateState(before, now);
  const original = structuredClone(before);
  // The operator's entire state patch is these three fields, after private archive.
  const cutover: MonitorState = { ...before, instanceId: 'synthetic-normal', heartbeat: null, receivedAt: null };
  assert.deepEqual(Object.keys(cutover).filter(key => JSON.stringify(cutover[key as keyof MonitorState]) !== JSON.stringify(before[key as keyof MonitorState])).sort(), ['heartbeat', 'instanceId', 'receivedAt']);
  const without = evaluate(validateState(cutover, now), now);
  assert.deepEqual(without.reasons, ['BACKLOG_OVERDUE', 'DEAD_LETTER', 'FIRST_HEARTBEAT_MISSING', 'WORKER_UNHEALTHY']);
  assert.deepEqual(without.state.events.slice(before.events.length).map(e => [e.reason, e.kind]), [
    ['FIRST_HEARTBEAT_MISSING', 'alert'], ['HEARTBEAT_MISSING', 'recovery'], ['HEARTBEAT_STALE', 'recovery'],
  ]);
  const repeated = evaluate(without.state, now + 1);
  assert.equal(repeated.state.sequence, without.state.sequence);
  // Independent initial grace boundary: retain operational reasons, recompute missing.
  const grace: MonitorState = { ...cutover, activatedAt: iso(-900_000), activeReasons: [...cutover.activeReasons, 'FIRST_HEARTBEAT_MISSING'] };
  assert.deepEqual(evaluate(grace, now).reasons, ['BACKLOG_OVERDUE', 'DEAD_LETTER', 'WORKER_UNHEALTHY']);
  assert.ok(evaluate(grace, now + 1).reasons.includes('FIRST_HEARTBEAT_MISSING'));
  const fresh63 = { ...heartbeat(), instanceId: cutover.instanceId, healthy: false };
  Object.assign(fresh63.lanes[0], { terminal: 63, oldestPendingSeconds: 901 });
  const measured63 = evaluate({ ...repeated.state, heartbeat: validateHeartbeat(fresh63, repeated.state, now), receivedAt: iso() }, now);
  assert.deepEqual(measured63.reasons, ['BACKLOG_OVERDUE', 'DEAD_LETTER', 'WORKER_UNHEALTHY']);
  assert.ok(measured63.state.events.every(e => e.kind !== 'recovery' || !['BACKLOG_OVERDUE', 'DEAD_LETTER'].includes(e.reason)));
  const fresh0 = { ...heartbeat(), instanceId: cutover.instanceId, completedAt: iso(1_000) };
  const measured0 = evaluate({ ...measured63.state, heartbeat: validateHeartbeat(fresh0, measured63.state, now + 1_000), receivedAt: iso(1_000) }, now + 1_000);
  assert.deepEqual(measured0.reasons, []);
  assert.deepEqual(measured0.state.events.slice(measured63.state.events.length).map(e => [e.reason, e.kind]), [
    ['WORKER_UNHEALTHY', 'recovery'], ['DEAD_LETTER', 'recovery'], ['BACKLOG_OVERDUE', 'recovery'],
  ]);
  for (const result of [without, repeated, measured63, measured0]) {
    assert.equal(result.state.activatedAt, original.activatedAt);
    assert.equal(result.state.instanceId, cutover.instanceId);
    assert.deepEqual(result.state.events.slice(0, original.events.length), original.events);
    assert.deepEqual(result.state.notificationDelivery, original.notificationDelivery);
    assert.equal(result.state.notificationDelivery!.batches[0].instanceId, original.instanceId);
    assert.ok(result.state.sequence >= original.sequence);
    assert.ok(result.state.events.slice(original.events.length).every(e => e.ownerAcknowledgedAt === null));
    validateState(result.state, now + 1_000);
  }
  assert.deepEqual(before, original);
});
