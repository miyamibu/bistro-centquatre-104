import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

function decodeBasicCredentials(base64Value: string) {
  const normalized = base64Value.trim();
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    return null;
  }

  const decodeWithUtf8 = (bytes: Uint8Array) => {
    try {
      if (typeof TextDecoder !== "undefined") {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
    } catch {
      return null;
    }

    try {
      if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("utf-8");
      }
    } catch {
      return null;
    }

    return null;
  };

  try {
    if (typeof atob === "function") {
      const binary = atob(normalized);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return decodeWithUtf8(bytes);
    }
  } catch {
    return null;
  }

  try {
    if (typeof Buffer === "undefined") {
      return null;
    }

    const decoded = Buffer.from(normalized, "base64");
    if (decoded.toString("base64") !== normalized) {
      return null;
    }
    return decodeWithUtf8(decoded);
  } catch {
    return null;
  }
}

export function parseBasicAuthHeader(header: string | null) {
  if (!header) return null;

  const match = header.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;

  const decoded = decodeBasicCredentials(match[1]);
  if (!decoded) return null;

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex < 1) return null;

  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);
  return { user, pass };
}

function safeEqual(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
}

export function isAuthorized(request: NextRequest) {
  const creds = parseBasicAuthHeader(request.headers.get("authorization"));
  if (!creds) return false;
  const expectedUser = env.ADMIN_BASIC_USER;
  const expectedPass = env.ADMIN_BASIC_PASS;
  if (!expectedUser || !expectedPass) return false;
  return safeEqual(creds.user ?? "", expectedUser) && safeEqual(creds.pass ?? "", expectedPass);
}

export function unauthorized() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": "Basic realm=\"Restricted\"",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export function requireBasicAuth(request: NextRequest) {
  if (!isAuthorized(request)) {
    return unauthorized();
  }
  return null;
}
