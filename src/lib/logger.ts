import type { NextRequest } from "next/server";

type LogLevel = "info" | "warn" | "error";

interface LogOptions {
  requestId?: string;
  route?: string;
  errorCode?: string;
  context?: Record<string, unknown>;
}

const REDACTED = "[REDACTED]";
const MAX_LOG_DEPTH = 6;
const MAX_ARRAY_ITEMS = 25;

const SENSITIVE_KEY_PATTERN =
  /(secret|token|authorization|cookie|password|apikey|api_key|idtoken|id_token|lineuserid|line_user_id|phone|email|address|note|databaseurl|database_url|db_url)/i;

const STRING_REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/\b(Basic)\s+[A-Za-z0-9+/=-]+/gi, "$1 [REDACTED]"],
  [/\b(postgres(?:ql)?|mysql|mongodb):\/\/[^\s"'<>]+/gi, "[REDACTED_URL]"],
  [/([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, "$1[REDACTED]@"],
  [/\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, "[REDACTED_EMAIL]"],
  [/\b(?:\+?81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}\b/g, "[REDACTED_PHONE]"],
  [/([?&](?:token|secret|password|api_key|apikey|id_token)=)[^&#\s]+/gi, "$1[REDACTED]"],
  [/\b(?:token|secret|password|api[_-]?key|id[_-]?token)=\S+/gi, "[REDACTED_SECRET]"],
];

function redactSensitiveString(value: string): string {
  return STRING_REDACTION_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value
  );
}

function serializeErrorForLog(error: Error): Record<string, unknown> {
  const output: Record<string, unknown> = {
    name: redactSensitiveString(error.name),
  };

  const errorWithMetadata = error as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    retryable?: unknown;
  };

  if (typeof errorWithMetadata.code === "string") {
    output.code = redactSensitiveString(errorWithMetadata.code);
  }
  if (typeof errorWithMetadata.status === "number") {
    output.status = errorWithMetadata.status;
  }
  if (typeof errorWithMetadata.statusCode === "number") {
    output.statusCode = errorWithMetadata.statusCode;
  }
  if (typeof errorWithMetadata.retryable === "boolean") {
    output.retryable = errorWithMetadata.retryable;
  }

  if (process.env.NODE_ENV !== "production") {
    output.message = redactSensitiveString(error.message);
  }

  return output;
}

function sanitizeForLog(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;

  if (typeof value === "string") return redactSensitiveString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();

  if (value instanceof Error) {
    return serializeErrorForLog(value);
  }

  if (depth >= MAX_LOG_DEPTH) {
    return "[MAX_DEPTH]";
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, depth + 1, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : sanitizeForLog(entry, depth + 1, seen);
    }
    return output;
  }

  return String(value);
}

function emit(level: LogLevel, event: string, options: LogOptions = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    requestId: options.requestId,
    route: options.route,
    errorCode: options.errorCode,
    context: sanitizeForLog(options.context),
  };

  const message = JSON.stringify(payload);
  if (level === "error") {
    console.error(message);
    return;
  }
  if (level === "warn") {
    console.warn(message);
    return;
  }
  console.info(message);
}

export function getRequestId(request: NextRequest): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function logInfo(event: string, options?: LogOptions) {
  emit("info", event, options);
}

export function logWarn(event: string, options?: LogOptions) {
  emit("warn", event, options);
}

export function logError(event: string, options?: LogOptions) {
  emit("error", event, options);
}

