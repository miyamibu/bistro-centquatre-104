import { timingSafeEqual } from "node:crypto";

export const MONITOR_KEY = { schedulerKind: "independent-outbox-monitor-v1", lane: "monitor" } as const;
export const REASONS = ["FIRST_HEARTBEAT_MISSING", "HEARTBEAT_MISSING", "HEARTBEAT_STALE", "WORKER_UNHEALTHY", "LANE_STORAGE_FAILED", "OUTCOME_UNKNOWN", "RECONCILE_REQUIRED", "DEAD_LETTER", "BACKLOG_OVERDUE", "UNSAFE_TRANSITION"] as const;
type Reason = typeof REASONS[number];
const COUNTERS = ["claimed", "accepted", "retryNotSent", "unknown", "unsafe"] as const;
const LANE_COUNTERS = ["pending", "due", "inflight", "unknown", "reconcile", "terminal", "oldestPendingSeconds"] as const;
type LaneName = "reservation" | "order";
type Lane = { lane: LaneName; ok: boolean } & Record<typeof LANE_COUNTERS[number], number>;
export type Heartbeat = { instanceId: string; completedAt: string; healthy: boolean; reasons: Reason[]; lanes: Lane[] } & Record<typeof COUNTERS[number], number>;
type Event = { sequence: number; reason: Reason; kind: "alert" | "recovery"; at: string; ownerAcknowledgedAt: string | null };
export type MonitorState = {
  version: 1; enabled: boolean; instanceId: string; activatedAt: string; expectedLanes: LaneName[];
  heartbeat: Heartbeat | null; receivedAt: string | null; activeReasons: Reason[];
  sequence: number; events: Event[]; lastEvaluatedAt: string | null;
};
export class MonitorError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
const reject = (code: string, status = 400): never => { throw new MonitorError(code, status); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000_000;
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const names = (v: unknown): v is LaneName[] => Array.isArray(v) && (JSON.stringify(v) === '["reservation"]' || JSON.stringify(v) === '["reservation","order"]');
const reasonList = (v: unknown): v is Reason[] => Array.isArray(v) && v.length <= REASONS.length && new Set(v).size === v.length && v.every(r => REASONS.includes(r));

export function validateHeartbeat(v: unknown, state: MonitorState, now: number): Heartbeat {
  if (!object(v) || !exact(v, ["instanceId", "completedAt", "healthy", "reasons", "lanes", ...COUNTERS]) ||
      v.instanceId !== state.instanceId || !instant(v.completedAt) || typeof v.healthy !== "boolean" ||
      !reasonList(v.reasons) || !COUNTERS.every(k => count(v[k])) || !Array.isArray(v.lanes) || v.lanes.length !== state.expectedLanes.length) reject("HEARTBEAT_INVALID");
  const body = v as unknown as Heartbeat;
  if (!state.expectedLanes.every(name => body.lanes.filter(l => l?.lane === name).length === 1) || body.lanes.some(l =>
      !object(l) || !exact(l, ["lane", "ok", ...LANE_COUNTERS]) || !state.expectedLanes.includes(l.lane) || typeof l.ok !== "boolean" || !LANE_COUNTERS.every(k => k === "oldestPendingSeconds" ? typeof l[k] === "number" && Number.isFinite(l[k]) && l[k] >= 0 && l[k] <= 1_000_000_000 : count(l[k])))) reject("LANES_INVALID");
  const completed = Date.parse(body.completedAt);
  if (completed < Date.parse(state.activatedAt) || completed < now - 900_000 || completed > now + 30_000) reject("HEARTBEAT_TIME_INVALID");
  if (state.heartbeat && completed <= Date.parse(state.heartbeat.completedAt)) reject("HEARTBEAT_REPLAY", 409);
  return body;
}

export function validateState(v: unknown, now: number): MonitorState {
  if (!object(v) || !exact(v, ["version", "enabled", "instanceId", "activatedAt", "expectedLanes", "heartbeat", "receivedAt", "activeReasons", "sequence", "events", "lastEvaluatedAt"]) || v.version !== 1 || typeof v.enabled !== "boolean" || typeof v.instanceId !== "string" ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(v.instanceId) || !instant(v.activatedAt) || !names(v.expectedLanes) ||
      !reasonList(v.activeReasons) || !count(v.sequence) || !Array.isArray(v.events) || v.events.length > 64 ||
      !(v.lastEvaluatedAt === null || instant(v.lastEvaluatedAt)) || !(v.receivedAt === null || instant(v.receivedAt)) ||
      !Object.hasOwn(v, "heartbeat")) reject("MONITOR_STATE_INVALID", 503);
  const state = v as unknown as MonitorState;
  if (state.enabled && Date.parse(state.activatedAt) > now) reject("MONITOR_STATE_INVALID", 503);
  if ((state.heartbeat === null) !== (state.receivedAt === null)) reject("MONITOR_STATE_INVALID", 503);
  if (state.heartbeat !== null) {
    // Validate persisted structure against its own receipt time, without replay comparison.
    try { validateHeartbeat(state.heartbeat, { ...state, heartbeat: null }, Date.parse(state.receivedAt!)); }
    catch { reject("MONITOR_STATE_INVALID", 503); }
    if (Date.parse(state.receivedAt!) < Date.parse(state.activatedAt) || Date.parse(state.receivedAt!) > now) reject("MONITOR_STATE_INVALID", 503);
  }
  if (state.events.some(e => !object(e) || !exact(e, ["sequence", "reason", "kind", "at", "ownerAcknowledgedAt"]) || !count(e.sequence) || e.sequence < 1 || e.sequence > state.sequence || !REASONS.includes(e.reason) ||
      !["alert", "recovery"].includes(e.kind) || !instant(e.at) || !(e.ownerAcknowledgedAt === null || instant(e.ownerAcknowledgedAt))) ||
      new Set(state.events.map(e => e.sequence)).size !== state.events.length) reject("MONITOR_STATE_INVALID", 503);
  return state;
}

export function evaluate(state: MonitorState, now: number): { state: MonitorState; reasons: Reason[]; pending: number } {
  const reasons = new Set<Reason>();
  const heartbeat = state.heartbeat;
  if (!heartbeat || !state.receivedAt) {
    if (now - Date.parse(state.activatedAt) > 900_000) reasons.add("FIRST_HEARTBEAT_MISSING");
  } else {
    if (now - Date.parse(state.receivedAt) > 900_000) reasons.add("HEARTBEAT_MISSING");
    if (now - Date.parse(heartbeat.completedAt) > 900_000) reasons.add("HEARTBEAT_STALE");
    if (!heartbeat.healthy || heartbeat.reasons.length) reasons.add("WORKER_UNHEALTHY");
    for (const reason of heartbeat.reasons) reasons.add(reason);
    if (heartbeat.unsafe > 0) reasons.add("UNSAFE_TRANSITION");
    if (heartbeat.unknown > 0) reasons.add("OUTCOME_UNKNOWN");
    for (const lane of heartbeat.lanes) {
      if (!lane.ok) reasons.add("LANE_STORAGE_FAILED");
      if (lane.unknown) reasons.add("OUTCOME_UNKNOWN");
      if (lane.reconcile) reasons.add("RECONCILE_REQUIRED");
      if (lane.terminal) reasons.add("DEAD_LETTER");
      if (lane.oldestPendingSeconds > 900) reasons.add("BACKLOG_OVERDUE");
    }
  }
  const activeReasons = [...reasons].sort();
  const events = state.events.filter(e => e.ownerAcknowledgedAt === null); // acknowledged history stays in backup/owner evidence
  let sequence = state.sequence;
  for (const reason of REASONS) {
    const was = state.activeReasons.includes(reason), is = reasons.has(reason);
    if (was !== is) events.push({ sequence: ++sequence, reason, kind: is ? "alert" : "recovery", at: new Date(now).toISOString(), ownerAcknowledgedAt: null });
  }
  if (events.length > 64 || sequence > 1_000_000_000) reject("MONITOR_EVENT_CAPACITY", 503);
  const updated = { ...state, sequence, events, activeReasons, lastEvaluatedAt: new Date(now).toISOString() };
  return { state: updated, reasons: activeReasons, pending: events.length };
}

export type MonitorStore = { transaction<T>(operation: (value: unknown, save: (value: MonitorState) => Promise<void>) => Promise<T>): Promise<T> };
function authorized(request: Request, expected: string | undefined) {
  if (!expected || expected.length < 1 || expected.length > 512) return false;
  const value = request.headers.get("authorization");
  if (!value || !value.startsWith("Bearer ")) return false;
  const actual = Buffer.from(value.slice(7)), target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}
async function boundedBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type") || "")) reject("JSON_REQUIRED", 415);
  const reader = request.body?.getReader();
  if (!reader) return reject("BODY_REQUIRED");
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length;
      if (bytes > 8192) { await reader.cancel(); reject("BODY_TOO_LARGE", 413); } chunks.push(chunk.value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) { if (error instanceof MonitorError) throw error; return reject("JSON_INVALID"); }
}
export function createMonitorHandler({ store, clock = Date.now, secrets }: { store: MonitorStore; clock?: () => number; secrets: () => { ingest?: string; evaluate?: string } }) {
  return async (request: Request, action: "heartbeat" | "evaluate"): Promise<Response> => {
    try {
      if (request.method !== "POST") reject("METHOD_NOT_ALLOWED", 405);
      const keys = secrets();
      // A dedicated ingest secret must differ from the GitHub evaluator secret.
      if (!keys.ingest || keys.ingest.length < 32 || !keys.evaluate || keys.evaluate.length < 32 || keys.evaluate.length > 512 || keys.ingest === keys.evaluate) reject("MONITOR_AUTH_NOT_CONFIGURED", 503);
      if (!authorized(request, action === "heartbeat" ? keys.ingest : keys.evaluate)) reject("UNAUTHORIZED", 401);
      const input = action === "heartbeat" ? await boundedBody(request) : null;
      const result = await store.transaction(async (value, save) => {
        const now = clock(); const state = validateState(value, now);
        if (!state.enabled) reject("MONITOR_DISABLED", 503);
        if (action === "heartbeat") {
          const heartbeat = validateHeartbeat(input, state, now);
          const receipt = { ...state, heartbeat, receivedAt: new Date(now).toISOString() };
          await save(evaluate(receipt, now).state);
          return { ok: true, durable: true };
        }
        const evaluation = evaluate(state, now);
        await save(evaluation.state);
        const heartbeatReceived = evaluation.state.heartbeat !== null;
        const healthy = !heartbeatReceived && evaluation.reasons.length === 0 ? null : evaluation.reasons.length === 0;
        const readiness = healthy === null ? "WAITING_FOR_FIRST_HEARTBEAT" : healthy ? "HEALTHY" : "UNHEALTHY";
        return { ok: true, healthy, heartbeatReceived, readiness, reasons: evaluation.reasons, pendingOwnerAcknowledgements: evaluation.pending,
          sequence: evaluation.state.sequence, pendingEvents: evaluation.state.events.map(({ sequence, reason, kind }) => ({ sequence, reason, kind })), notificationDelivery: "UNVERIFIED" };
      }); // the store resolves only after transaction COMMIT; no 2xx on failed commit
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const known = error instanceof MonitorError;
      return Response.json({ ok: false, code: known ? error.code : "MONITOR_STORAGE_FAILED" }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}
