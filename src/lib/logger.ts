import type { NextRequest } from "next/server";

type LogLevel = "info" | "warn" | "error";

interface LogOptions {
  requestId?: string;
  route?: string;
  errorCode?: string;
  context?: Record<string, unknown>;
}

function emit(level: LogLevel, event: string, options: LogOptions = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    requestId: options.requestId,
    route: options.route,
    errorCode: options.errorCode,
    context: options.context,
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

