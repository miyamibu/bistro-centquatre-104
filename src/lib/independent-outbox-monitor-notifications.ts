import { createHash } from "node:crypto";
import type { MonitorState, MonitorStore, Reason } from "./independent-outbox-monitor";

const MAX_BATCHES = 64, MAX_BATCH_EVENTS = 16, MAX_BYTES = 196_608;
export const PROVIDER_TIMEOUT_MS = 8_000;
export const RETRY_WINDOW_MS = 86_400_000 - 60_000; // conservative margin inside the ORIGINAL 24h
const LEASE_MS = 30_000, COOLDOWN_MS = 60_000;
const CODES = ["CONFIGURATION_INVALID", "CONFIGURATION_DRIFT", "CLAIM_IN_FLIGHT", "RETRY_COOLDOWN", "PROVIDER_NETWORK_OR_TIMEOUT", "PROVIDER_HTTP_REJECTED", "PROVIDER_RESPONSE_INVALID", "RETRY_WINDOW_EXPIRED", "ATTEMPT_CAPACITY", "HISTORY_CAPACITY", "MORE_EVENTS_PENDING", "STORAGE_UNVERIFIED", "PROVIDER_RECEIPT_CONFLICT", "MONITOR_DISABLED"] as const;
type Code = typeof CODES[number];
type Tuple = { sequence: number; reason: Reason; kind: "alert" | "recovery"; at: string };
export type NotificationBatch = {
  batchId: string; instanceId: string; events: Tuple[]; idempotencyKey: string; requestSHA256: string;
  firstAttemptAt: string; lastAttemptAt: string; attempt: number;
  state: "SENDING" | "ACCEPTED" | "UNKNOWN" | "UNRESOLVED";
  leaseUntil: string | null; providerId: string | null; acceptedAt: string | null; code: Code | null;
};
export type NotificationMetadata = { version: 1; throughSequence: number; batches: NotificationBatch[] };
export type NotificationSummary = {
  status: "IDLE" | "ACCEPTED" | "PENDING" | "SENDING" | "UNKNOWN" | "UNRESOLVED" | "NOT_CONFIGURED";
  throughSequence: number; pendingCount: number; batchId: string | null;
  providerAcceptedAt: string | null; code: Code | null;
  inboxReceipt: "UNVERIFIED"; ownerAcknowledgement: "SEPARATE";
};
export type RuntimeNotificationConfig = { ownerEmail?: string; from?: string; apiKey?: string; provider?: string };
type Config = { ownerEmail: string; from: string; apiKey: string; provider: "resend" };
const fail = (): never => { throw new Error("MONITOR_NOTIFICATION_STATE_INVALID"); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (v: unknown, max = 1_000_000_000): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const instant = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const tuple = ({ sequence, reason, kind, at }: Tuple): Tuple => ({ sequence, reason, kind, at });
const identity = (instanceId: string, events: Tuple[]) => hash(JSON.stringify({ version: 1, instanceId, events: events.map(tuple) }));
const key = (batchId: string) => `outbox-monitor/v1/${batchId}`;
const hasReceipt = (b: NotificationBatch) => b.providerId !== null && b.acceptedAt !== null;
export function notificationAccepted(metadata: NotificationMetadata | undefined, sequence: number) {
  return metadata?.batches.some(b => hasReceipt(b) && b.events.some(e => e.sequence === sequence)) ?? false;
}
export function validateNotificationMetadata(value: unknown, state: MonitorState, now: number, reasons: readonly string[]): NotificationMetadata {
  if (!object(value) || !exact(value, ["version", "throughSequence", "batches"]) || value.version !== 1 || !integer(value.throughSequence) || !Array.isArray(value.batches) || value.batches.length > MAX_BATCHES || Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) fail();
  const metadata = value as unknown as NotificationMetadata;
  let through = 0, lastSequence = 0, open = 0;
  const batchIDs = new Set<string>();
  for (const [index, b] of metadata.batches.entries()) {
    if (!object(b) || !exact(b, ["batchId", "instanceId", "events", "idempotencyKey", "requestSHA256", "firstAttemptAt", "lastAttemptAt", "attempt", "state", "leaseUntil", "providerId", "acceptedAt", "code"]) || !digest(b.batchId) || typeof b.instanceId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(b.instanceId) || !Array.isArray(b.events) || b.events.length < 1 || b.events.length > MAX_BATCH_EVENTS || !digest(b.requestSHA256) || b.idempotencyKey !== key(b.batchId) || !instant(b.firstAttemptAt) || !instant(b.lastAttemptAt) || Date.parse(b.firstAttemptAt) > Date.parse(b.lastAttemptAt) || Date.parse(b.lastAttemptAt) > now || !integer(b.attempt, 1000) || b.attempt < 1 || !["SENDING", "UNKNOWN", "ACCEPTED", "UNRESOLVED"].includes(b.state) || !(b.code === null || CODES.includes(b.code))) fail();
    for (const e of b.events) {
      if (!object(e) || !exact(e, ["sequence", "reason", "kind", "at"]) || !integer(e.sequence) || e.sequence < 1 || e.sequence <= lastSequence || e.sequence > state.sequence || !reasons.includes(e.reason) || !["alert", "recovery"].includes(e.kind) || !instant(e.at) || Date.parse(e.at) > Date.parse(b.firstAttemptAt)) fail();
      lastSequence = e.sequence;
      const source = state.events.find(v => v.sequence === e.sequence);
      if (source && JSON.stringify(tuple(source)) !== JSON.stringify(tuple(e))) fail();
      if (!source && b.state !== "ACCEPTED" && !hasReceipt(b)) fail();
    }
    if (b.batchId !== identity(b.instanceId, b.events) || batchIDs.has(b.batchId)) fail();
    batchIDs.add(b.batchId);
    if (!(b.providerId === null || typeof b.providerId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(b.providerId)) || !(b.acceptedAt === null || instant(b.acceptedAt) && Date.parse(b.acceptedAt) >= Date.parse(b.firstAttemptAt) && Date.parse(b.acceptedAt) <= now) || (b.providerId === null) !== (b.acceptedAt === null)) fail();
    if (b.state === "ACCEPTED") {
      if (!hasReceipt(b) || b.leaseUntil !== null || b.code !== null) fail();
    } else {
      open++;
      if (index !== metadata.batches.length - 1) fail();
      if (b.state === "SENDING") {
        if (hasReceipt(b) || !instant(b.leaseUntil) || Date.parse(b.leaseUntil) !== Date.parse(b.lastAttemptAt) + LEASE_MS || b.code !== null) fail();
      } else if (b.leaseUntil !== null || b.code === null || hasReceipt(b) && !(b.state === "UNRESOLVED" && b.code === "PROVIDER_RECEIPT_CONFLICT")) fail();
    }
    if (hasReceipt(b)) through = Math.max(through, b.events[b.events.length - 1].sequence);
  }
  if (open > 1 || metadata.throughSequence !== through || through > state.sequence) fail();
  return metadata;
}
function metadata(state: MonitorState): NotificationMetadata {
  return state.notificationDelivery ?? { version: 1, throughSequence: 0, batches: [] };
}
function pending(state: MonitorState) {
  const m = metadata(state), tuples = new Set<number>();
  for (const e of state.events) if (!notificationAccepted(m, e.sequence)) tuples.add(e.sequence);
  for (const b of m.batches) if (!hasReceipt(b)) for (const e of b.events) tuples.add(e.sequence);
  return tuples.size;
}
function summary(state: MonitorState, code: Code | null = null, override?: NotificationSummary["status"]): NotificationSummary {
  const m = metadata(state), b = m.batches[m.batches.length - 1], count = pending(state);
  const status = override ?? (b?.state === "UNRESOLVED" ? "UNRESOLVED" : b?.state === "UNKNOWN" ? "UNKNOWN" : b?.state === "SENDING" ? "SENDING" : count ? "PENDING" : b && hasReceipt(b) ? "ACCEPTED" : "IDLE");
  return { status, throughSequence: m.throughSequence, pendingCount: count, batchId: b?.batchId ?? null,
    providerAcceptedAt: b?.acceptedAt ?? null, code: code ?? b?.code ?? null, inboxReceipt: "UNVERIFIED", ownerAcknowledgement: "SEPARATE" };
}
export function unavailableNotificationSummary(state: MonitorState) { return summary(state, "CONFIGURATION_INVALID", "NOT_CONFIGURED"); }
function config(raw: RuntimeNotificationConfig): Config | null {
  const mailbox = (v: unknown): v is string => typeof v === "string" && v.length <= 254 && /^[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+$/.test(v);
  if (!raw || raw.provider !== "resend" || !mailbox(raw.ownerEmail) || !mailbox(raw.from) || raw.from === "no-reply@example.com" || typeof raw.apiKey !== "string" || !/^[!-~]{1,4096}$/.test(raw.apiKey)) return null;
  return raw as Config;
}
function body(b: Pick<NotificationBatch, "instanceId" | "events">, c: Config) {
  const alerts = b.events.filter(e => e.kind === "alert").length;
  return JSON.stringify({ from: c.from, to: [c.ownerEmail], subject: "Bistro monitor: operational events",
    text: [`Independent outbox monitor`, `instance=${b.instanceId}`, `events=${b.events.length}; alerts=${alerts}; recoveries=${b.events.length - alerts}`,
      ...b.events.map(e => `event=${e.sequence}; reason=${e.reason}; kind=${e.kind}; at=${e.at}`)].join("\n") });
}
function replace(state: MonitorState, batch: NotificationBatch): MonitorState {
  const m = metadata(state), batches = m.batches.map(b => b.batchId === batch.batchId ? batch : b);
  return { ...state, notificationDelivery: { version: 1, batches,
    throughSequence: Math.max(0, ...batches.filter(hasReceipt).map(b => b.events[b.events.length - 1].sequence)) } };
}
type ProviderResult = { accepted: true; id: string } | { accepted: false; code: Code };
async function post(c: Config, b: NotificationBatch, payload: string, fetchImpl: typeof fetch): Promise<ProviderResult> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    if (hash(payload) !== b.requestSHA256 || Buffer.byteLength(payload) > 8192) return { accepted: false, code: "CONFIGURATION_DRIFT" };
    const response = await fetchImpl("https://api.resend.com/emails", { method: "POST", redirect: "error", signal: controller.signal,
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": b.idempotencyKey }, body: payload });
    if (response.status !== 200 && response.status !== 201) { await response.body?.cancel(); return { accepted: false, code: "PROVIDER_HTTP_REJECTED" }; }
    const reader = response.body?.getReader(); if (!reader) return { accepted: false, code: "PROVIDER_RESPONSE_INVALID" };
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > 4096) { await reader.cancel(); return { accepted: false, code: "PROVIDER_RESPONSE_INVALID" }; } chunks.push(r.value); }
    let receipt: unknown; try { receipt = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return { accepted: false, code: "PROVIDER_RESPONSE_INVALID" }; }
    if (!object(receipt) || !exact(receipt, ["id"]) || typeof receipt.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.id)) return { accepted: false, code: "PROVIDER_RESPONSE_INVALID" };
    return { accepted: true, id: receipt.id };
  } catch { return { accepted: false, code: "PROVIDER_NETWORK_OR_TIMEOUT" }; }
  finally { clearTimeout(timer); }
}
export function createNotificationDispatcher({ store, validate, getConfig, clock = Date.now, fetchImpl = globalThis.fetch }: {
  store: MonitorStore; validate: (v: unknown, now: number) => MonitorState; getConfig: () => RuntimeNotificationConfig; clock?: () => number; fetchImpl?: typeof fetch;
}) {
  return async (): Promise<NotificationSummary> => {
    let c: Config | null = null, last: MonitorState | null = null;
    try { c = config(getConfig()); } catch { /* fixed sanitized configuration status only */ }
    try {
      const claimed = await store.transaction(async (value, save) => {
        const now = clock(); let s = validate(value, now); last = s;
        if (!s.enabled || !c) { await save(s); return { result: summary(s, s.enabled ? "CONFIGURATION_INVALID" : "MONITOR_DISABLED", s.enabled ? "NOT_CONFIGURED" : "UNRESOLVED") }; }
        const m = metadata(s);
        let batch = m.batches.find(b => b.state !== "ACCEPTED");
        if (batch) {
          if (batch.state === "UNRESOLVED") { await save(s); return { result: summary(s) }; }
          if (hash(body(batch, c)) !== batch.requestSHA256) {
            s = replace(s, { ...batch, state: "UNRESOLVED", leaseUntil: null, code: "CONFIGURATION_DRIFT" }); await save(s); return { result: summary(s) };
          }
          if (now + PROVIDER_TIMEOUT_MS >= Date.parse(batch.firstAttemptAt) + RETRY_WINDOW_MS) {
            s = replace(s, { ...batch, state: "UNRESOLVED", leaseUntil: null, code: "RETRY_WINDOW_EXPIRED" }); await save(s); return { result: summary(s) };
          }
          if (now < Date.parse(batch.lastAttemptAt) + COOLDOWN_MS) { await save(s); return { result: summary(s, batch.state === "SENDING" ? "CLAIM_IN_FLIGHT" : "RETRY_COOLDOWN") }; }
          if (batch.attempt >= 1000) { s = replace(s, { ...batch, state: "UNRESOLVED", leaseUntil: null, code: "ATTEMPT_CAPACITY" }); await save(s); return { result: summary(s) }; }
          batch = { ...batch, state: "SENDING", attempt: batch.attempt + 1, lastAttemptAt: new Date(now).toISOString(), leaseUntil: new Date(now + LEASE_MS).toISOString(), code: null };
          s = replace(s, batch);
        } else {
          const selected = s.events.filter(e => !notificationAccepted(m, e.sequence)).sort((a, b) => a.sequence - b.sequence).slice(0, MAX_BATCH_EVENTS).map(tuple);
          if (!selected.length) { await save(s); return { result: summary(s) }; }
          if (m.batches.length >= MAX_BATCHES) { await save(s); return { result: summary(s, "HISTORY_CAPACITY", "UNRESOLVED") }; }
          const id = identity(s.instanceId, selected), stamp = new Date(now).toISOString();
          batch = { batchId: id, instanceId: s.instanceId, events: selected, idempotencyKey: key(id), requestSHA256: "", firstAttemptAt: stamp, lastAttemptAt: stamp, attempt: 1, state: "SENDING", leaseUntil: new Date(now + LEASE_MS).toISOString(), providerId: null, acceptedAt: null, code: null };
          batch.requestSHA256 = hash(body(batch, c));
          s = { ...s, notificationDelivery: { ...m, batches: [...m.batches, batch] } };
        }
        validate(s, now); await save(s);
        return { batch: structuredClone(batch), payload: body(batch, c) };
      }); // must resolve AFTER COMMIT + durable autocommit readback, before any provider call
      if ("result" in claimed) return claimed.result!;
      const claim = claimed.batch!;
      // Recheck original window after potentially slow commit/readback; never mint a fresh key.
      if (clock() + PROVIDER_TIMEOUT_MS >= Date.parse(claim.firstAttemptAt) + RETRY_WINDOW_MS) {
        return await store.transaction(async (value, save) => {
          let s = validate(value, clock()); const b = metadata(s).batches.find(x => x.batchId === claim.batchId)!;
          if (b?.state === "SENDING" && b.attempt === claim.attempt) s = replace(s, { ...b, state: "UNRESOLVED", leaseUntil: null, code: "RETRY_WINDOW_EXPIRED" });
          await save(s); return summary(s);
        });
      }
      if (clock() < Date.parse(claim.lastAttemptAt)) return summary(last!, "STORAGE_UNVERIFIED", "UNRESOLVED");
      const outcome = await post(c!, claim, claimed.payload!, fetchImpl); // one call, no retries
      return await store.transaction(async (value, save) => {
        const now = clock(); let s = validate(value, now); const b = metadata(s).batches.find(x => x.batchId === claim.batchId);
        if (!b || b.requestSHA256 !== claim.requestSHA256 || b.firstAttemptAt !== claim.firstAttemptAt || b.idempotencyKey !== claim.idempotencyKey) return fail();
        if (outcome.accepted) {
          if (hasReceipt(b) && b.providerId !== outcome.id) s = replace(s, { ...b, state: "UNRESOLVED", leaseUntil: null, code: "PROVIDER_RECEIPT_CONFLICT" });
          else if (!hasReceipt(b)) s = replace(s, { ...b, state: "ACCEPTED", providerId: outcome.id, acceptedAt: new Date(now).toISOString(), leaseUntil: null, code: null });
        } else if (b.state === "SENDING" && b.attempt === claim.attempt && b.lastAttemptAt === claim.lastAttemptAt) {
          s = replace(s, { ...b, state: "UNKNOWN", leaseUntil: null, code: outcome.code });
        }
        validate(s, now); await save(s);
        return summary(s, pending(s) && metadata(s).batches.every(x => x.state === "ACCEPTED") ? "MORE_EVENTS_PENDING" : null);
      });
    } catch {
      if (last) return summary(last, "STORAGE_UNVERIFIED", "UNRESOLVED");
      return { status: "UNRESOLVED", throughSequence: 0, pendingCount: 0, batchId: null, providerAcceptedAt: null,
        code: "STORAGE_UNVERIFIED", inboxReceipt: "UNVERIFIED", ownerAcknowledgement: "SEPARATE" };
    }
  };
}
