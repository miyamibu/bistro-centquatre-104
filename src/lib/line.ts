import { randomBytes, randomUUID, createHash } from "node:crypto";
import {
  getLineChannelAccessToken,
  getLineLoginChannelId,
  hasLineLoginEnv,
  hasLineMessagingEnv,
} from "@/lib/env";
import { logError, logInfo, logWarn } from "@/lib/logger";

// LINE Login / LIFF / Messaging API channels MUST live under the same LINE
// Developers Provider — otherwise the userId axis differs and the ID token
// `sub` cannot be used as a Messaging API push destination. This invariant is
// enforced at LINE Developers configuration time, not in code.

export const LINE_USER_ID_REGEX = /^U[0-9a-f]{32}$/;

const LINE_VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";
const LINE_PROFILE_ENDPOINT = "https://api.line.me/v2/bot/profile";
const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const LINE_QUOTA_CONSUMPTION_ENDPOINT =
  "https://api.line.me/v2/bot/message/quota/consumption";

const LINE_FETCH_TIMEOUT_MS = 8000;

function truncateError(message: string, limit = 240): string {
  if (message.length <= limit) return message;
  return `${message.slice(0, limit)}…`;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = LINE_FETCH_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type LineVerifyResponse = {
  iss?: string;
  sub?: string;
  aud?: string;
  exp?: number;
};

/**
 * Verify a LINE LIFF ID token via the LINE Login verify endpoint.
 * Returns the verified `sub` (LINE userId) on success, or `null` on any failure.
 * Never logs the token itself.
 */
export async function verifyLineIdToken(idToken: string): Promise<string | null> {
  if (!idToken || typeof idToken !== "string") return null;
  if (!hasLineLoginEnv()) {
    logWarn("line.verify.skipped.login_not_configured");
    return null;
  }

  const channelId = getLineLoginChannelId();
  if (!channelId) return null;

  const body = new URLSearchParams();
  body.set("id_token", idToken);
  body.set("client_id", channelId);

  let response: Response;
  try {
    response = await fetchWithTimeout(LINE_VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
  } catch (error) {
    logWarn("line.verify.network_failed", {
      context: {
        message: truncateError(error instanceof Error ? error.message : String(error)),
      },
    });
    return null;
  }

  if (!response.ok) {
    logWarn("line.verify.bad_status", {
      context: { status: response.status },
    });
    return null;
  }

  let payload: LineVerifyResponse;
  try {
    payload = (await response.json()) as LineVerifyResponse;
  } catch {
    logWarn("line.verify.parse_failed");
    return null;
  }

  if (payload.iss !== "https://access.line.me") return null;
  if (payload.aud !== channelId) return null;
  if (!payload.sub || !LINE_USER_ID_REGEX.test(payload.sub)) return null;
  if (typeof payload.exp === "number") {
    const expMs = payload.exp * 1000;
    if (Number.isFinite(expMs) && expMs < Date.now()) return null;
  }

  return payload.sub;
}

export type CanPushResult =
  | { status: "ACTIVE" }
  | { status: "BLOCKED" }
  | { status: "PENDING_CHECK"; error?: string };

/**
 * Check whether the bot can push to the given LINE userId.
 * Returns a classified result rather than a boolean so callers can track
 * the reason (network failure vs. definitive block).
 */
export async function canPushToLineUser(lineUserId: string): Promise<CanPushResult> {
  if (!LINE_USER_ID_REGEX.test(lineUserId)) {
    return { status: "BLOCKED" };
  }
  if (!hasLineMessagingEnv()) {
    return { status: "PENDING_CHECK", error: "LINE messaging env not configured" };
  }
  const token = getLineChannelAccessToken();
  if (!token) {
    return { status: "PENDING_CHECK", error: "missing channel access token" };
  }

  try {
    const response = await fetchWithTimeout(
      `${LINE_PROFILE_ENDPOINT}/${encodeURIComponent(lineUserId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );
    if (response.status === 200) return { status: "ACTIVE" };
    if (response.status === 404) return { status: "BLOCKED" };
    return { status: "PENDING_CHECK", error: `LINE profile status ${response.status}` };
  } catch (error) {
    const msg = truncateError(error instanceof Error ? error.message : String(error));
    logWarn("line.canPush.network_failed", { context: { message: msg } });
    return { status: "PENDING_CHECK", error: msg };
  }
}

// ── Token / phone utilities ──────────────────────────────────────────────────

/**
 * Generate a cryptographically secure, URL-safe one-time link token (256 bits).
 * Never log the returned value.
 */
export function generateLineLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash a raw link token with SHA-256 + server-side pepper for at-rest storage.
 * In production, LINE_LINK_TOKEN_PEPPER must be set; dev uses a fallback.
 * Never log the rawToken.
 */
export function hashLineLinkToken(rawToken: string): string {
  const pepper = process.env.LINE_LINK_TOKEN_PEPPER;
  if (!pepper) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("LINE_LINK_TOKEN_PEPPER is required in production for LINE link tokens");
    }
    return createHash("sha256").update(`dev-pepper:${rawToken}`).digest("hex");
  }
  return createHash("sha256").update(`${pepper}:${rawToken}`).digest("hex");
}

/**
 * Normalize a Japanese phone number for matching:
 * - full-width digits → ASCII
 * - strip all non-digit characters (spaces, hyphens, dots, parens, etc.)
 */
export function normalizeReservationPhone(phone: string): string {
  return phone
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, "");
}

/** Return the last 4 digits of a normalized phone number for confirmation UI. */
export function getPhoneLast4(phone: string): string {
  return normalizeReservationPhone(phone).slice(-4);
}

/**
 * Hash a normalized phone for LineCustomerLink storage (uses same pepper).
 * Never log the input.
 */
export function hashNormalizedPhone(normalizedPhone: string): string {
  const pepper = process.env.LINE_LINK_TOKEN_PEPPER;
  if (!pepper) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("LINE_LINK_TOKEN_PEPPER is required in production for hashNormalizedPhone");
    }
    return createHash("sha256").update(`phone:dev-phone-pepper:${normalizedPhone}`).digest("hex");
  }
  return createHash("sha256").update(`phone:${pepper}:${normalizedPhone}`).digest("hex");
}

export type PushLineTextResult = {
  ok: boolean;
  error?: string;
  requestId?: string;
};

export type PushLineTextArgs = {
  to: string;
  text: string;
  retryKey?: string;
};

/**
 * Send a single text message via LINE Messaging Push API.
 * Treats HTTP 409 (idempotent replay) as success.
 */
export async function pushLineTextMessage(
  args: PushLineTextArgs
): Promise<PushLineTextResult> {
  if (!LINE_USER_ID_REGEX.test(args.to)) {
    return { ok: false, error: "invalid lineUserId" };
  }
  if (!hasLineMessagingEnv()) {
    return { ok: false, error: "LINE messaging env not configured" };
  }
  const token = getLineChannelAccessToken();
  if (!token) return { ok: false, error: "missing channel access token" };

  const retryKey = args.retryKey && /^[0-9a-f-]{36}$/i.test(args.retryKey)
    ? args.retryKey
    : randomUUID();

  let response: Response;
  try {
    response = await fetchWithTimeout(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Line-Retry-Key": retryKey,
      },
      body: JSON.stringify({
        to: args.to,
        messages: [{ type: "text", text: args.text }],
      }),
    });
  } catch (error) {
    return {
      ok: false,
      error: truncateError(error instanceof Error ? error.message : String(error)),
    };
  }

  const requestId = response.headers.get("x-line-request-id") ?? undefined;

  if (response.status === 200) {
    return { ok: true, requestId };
  }
  if (response.status === 409) {
    // already accepted (replay) — treat as success
    return { ok: true, requestId };
  }

  let detail = `LINE push failed: status=${response.status}`;
  try {
    const text = await response.text();
    if (text) detail = truncateError(`${detail} ${text}`);
  } catch {
    // ignore parse errors
  }
  return { ok: false, error: detail, requestId };
}

/**
 * Fetch the monthly LINE message quota consumption (approximate, includes manual sends).
 * For observability/logging only — do not gate sending on this value.
 */
export async function getLineMonthlyQuotaConsumption(): Promise<number | null> {
  if (!hasLineMessagingEnv()) return null;
  const token = getLineChannelAccessToken();
  if (!token) return null;

  try {
    const response = await fetchWithTimeout(LINE_QUOTA_CONSUMPTION_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { totalUsage?: number | string };
    const usage = typeof json.totalUsage === "string" ? Number(json.totalUsage) : json.totalUsage;
    return Number.isFinite(usage) ? Number(usage) : null;
  } catch (error) {
    logInfo("line.quota.fetch_failed", {
      context: {
        message: truncateError(error instanceof Error ? error.message : String(error)),
      },
    });
    return null;
  }
}

/**
 * Build the day-before reminder text. Intentionally omits name, phone, allergies, and notes.
 */
export function buildReminderText(args: {
  date: string;
  arrivalTime: string | null;
  partySize: number;
}): string {
  const lines = [
    "【bistro centquatre 104】ご予約前日のお知らせ",
    "",
    `明日 ${args.date}${args.arrivalTime ? ` ${args.arrivalTime}` : ""}、${args.partySize}名様でご予約を承っています。`,
    "ご変更・キャンセルはお電話でご連絡ください。",
  ];
  return lines.join("\n");
}

/**
 * Deterministic retry key derived from reservation id and the target reminder date.
 * Since LINE's retry-key validity is 24h, the targetDate boundary naturally rotates the key.
 */
export function buildReminderRetryKey(reservationId: string, targetDate: string): string {
  const digest = createHash("sha256")
    .update(`${reservationId}|${targetDate}`)
    .digest("hex");
  // Build a v5-style UUID layout (the value is opaque to LINE).
  const b = digest.slice(0, 32);
  const time = `${b.slice(0, 8)}-${b.slice(8, 12)}-5${b.slice(13, 16)}-8${b.slice(17, 20)}-${b.slice(20, 32)}`;
  return time;
}

export function summarizeLineError(err: unknown): string {
  if (!err) return "unknown";
  return truncateError(err instanceof Error ? err.message : String(err));
}

const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";

export type ReplyLineTextArgs = {
  replyToken: string;
  text: string;
};

/**
 * Send a reply message via LINE Messaging Reply API.
 * Reply tokens expire in ~30 seconds — call promptly after receiving the event.
 * Delivery errors are logged without the reply token; webhook handlers must return 200 regardless.
 */
export async function replyLineTextMessage(args: ReplyLineTextArgs): Promise<void> {
  if (!hasLineMessagingEnv()) return;
  const token = getLineChannelAccessToken();
  if (!token) return;

  try {
    await fetchWithTimeout(LINE_REPLY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        replyToken: args.replyToken,
        messages: [{ type: "text", text: args.text }],
      }),
    });
  } catch (error) {
    logError("line.reply.failed", {
      route: "/api/line/webhook",
      errorCode: "LINE_REPLY_FAILED",
      context: { error },
    });
  }
}

// Re-export for cron/route consumers that previously imported from env.
export { hasLineMessagingEnv } from "@/lib/env";
