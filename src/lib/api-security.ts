import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export type ApiFieldErrors = Record<string, string>;

interface ErrorPayload {
  error: string;
  code: string;
  fields?: ApiFieldErrors;
  requestId?: string;
  details?: string;
  [key: string]: unknown;
}

interface WriteSecurityOptions {
  requestId?: string;
  requireRequestedWith?: boolean;
  requireOrigin?: boolean;
  maxBytes?: number;
}

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;
export const ORDER_JSON_BODY_LIMIT_BYTES = 128 * 1024;
export const PDF_JSON_BODY_LIMIT_BYTES = 8 * 1024;

export type JsonReadResult<T = unknown> =
  | { ok: true; body: T }
  | { ok: false; response: NextResponse };

function resolveAllowedOrigins(request: NextRequest) {
  const origins = new Set<string>([request.nextUrl.origin]);
  if (env.BASE_URL) {
    try {
      origins.add(new URL(env.BASE_URL).origin);
    } catch {
      // Ignore invalid BASE_URL because env schema can be relaxed in non-prod.
    }
  }
  return origins;
}

export function apiError(
  status: number,
  payload: ErrorPayload,
  init?: Omit<ResponseInit, "status">
) {
  const response = NextResponse.json(payload, {
    status,
    ...(init ?? {}),
  });
  if (status === 401 || status === 403) {
    if (!response.headers.has("Cache-Control")) {
      response.headers.set("Cache-Control", "private, no-store");
    }
    if (!response.headers.has("Vary")) {
      response.headers.set("Vary", "Authorization, Origin");
    }
  }
  return response;
}

export function enforceWriteRequestSecurity(
  request: NextRequest,
  options: WriteSecurityOptions = {}
) {
  const { requestId, requireRequestedWith = true, requireOrigin = true, maxBytes } = options;
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return apiError(415, {
      error: "JSON body is required",
      code: "INVALID_CONTENT_TYPE",
      requestId,
    });
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return apiError(403, {
      error: "Cross-site requests are not allowed",
      code: "CSRF_BLOCKED",
      requestId,
    });
  }

  const origin = request.headers.get("origin");
  if (requireOrigin && !origin) {
    return apiError(403, {
      error: "Origin header is required",
      code: "ORIGIN_REQUIRED",
      requestId,
    });
  }
  if (origin) {
    const allowedOrigins = resolveAllowedOrigins(request);
    if (!allowedOrigins.has(origin)) {
      return apiError(403, {
        error: "Origin not allowed",
        code: "ORIGIN_NOT_ALLOWED",
        requestId,
      });
    }
  }

  if (requireRequestedWith) {
    const xRequestedWith = request.headers.get("x-requested-with");
    if (xRequestedWith !== "XMLHttpRequest") {
      return apiError(400, {
        error: "Missing X-Requested-With header",
        code: "MISSING_REQUEST_HEADER",
        requestId,
      });
    }
  }

  if (typeof maxBytes === "number") {
    const contentLength = request.headers.get("content-length");
    if (contentLength) {
      const parsedLength = Number(contentLength);
      if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
        return apiError(400, {
          error: "Invalid Content-Length",
          code: "INVALID_CONTENT_LENGTH",
          requestId,
        });
      }
      if (parsedLength > maxBytes) {
        return apiError(413, {
          error: "Request body is too large",
          code: "BODY_TOO_LARGE",
          requestId,
        });
      }
    }
  }

  return null;
}

export function enforceReadRequestSecurity(request: NextRequest, requestId?: string) {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return apiError(403, {
      error: "Cross-site requests are not allowed",
      code: "CSRF_BLOCKED",
      requestId,
    });
  }

  const origin = request.headers.get("origin");
  if (origin && !resolveAllowedOrigins(request).has(origin)) {
    return apiError(403, {
      error: "Origin not allowed",
      code: "ORIGIN_NOT_ALLOWED",
      requestId,
    });
  }

  if (request.headers.get("x-requested-with") !== "XMLHttpRequest") {
    return apiError(400, {
      error: "Missing X-Requested-With header",
      code: "MISSING_REQUEST_HEADER",
      requestId,
    });
  }

  return null;
}

export async function readLimitedJson<T = unknown>(
  request: NextRequest,
  options: WriteSecurityOptions = {}
): Promise<JsonReadResult<T>> {
  const maxBytes = options.maxBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES;
  const securityError = enforceWriteRequestSecurity(request, {
    ...options,
    maxBytes,
  });
  if (securityError) {
    return { ok: false, response: securityError };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return {
      ok: false,
      response: apiError(400, {
        error: "JSON body is required",
        code: "MISSING_BODY",
        requestId: options.requestId,
      }),
    };
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return {
        ok: false,
        response: apiError(413, {
          error: "Request body is too large",
          code: "BODY_TOO_LARGE",
          requestId: options.requestId,
        }),
      };
    }
    chunks.push(value);
  }

  const raw = new TextDecoder().decode(joinChunks(chunks, received));
  try {
    return { ok: true, body: JSON.parse(raw) as T };
  } catch {
    return {
      ok: false,
      response: apiError(400, {
        error: "Malformed JSON body",
        code: "MALFORMED_JSON",
        requestId: options.requestId,
      }),
    };
  }
}

function joinChunks(chunks: Uint8Array[], totalLength: number) {
  if (chunks.length === 1) return chunks[0]!;
  const joined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
