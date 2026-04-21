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
}

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
  return NextResponse.json(payload, {
    status,
    ...(init ?? {}),
  });
}

export function enforceWriteRequestSecurity(
  request: NextRequest,
  options: WriteSecurityOptions = {}
) {
  const { requestId, requireRequestedWith = true } = options;
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

  return null;
}
