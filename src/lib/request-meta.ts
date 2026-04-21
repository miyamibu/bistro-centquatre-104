import { createHash } from "crypto";
import type { NextRequest } from "next/server";

function firstForwardedAddress(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim();
  return first || null;
}

export function getClientIp(request: NextRequest): string | null {
  const forwarded = firstForwardedAddress(request.headers.get("x-forwarded-for"));
  if (forwarded) {
    return forwarded;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return null;
}

export function getUserAgent(request: NextRequest): string | null {
  const userAgent = request.headers.get("user-agent")?.trim();
  if (!userAgent) {
    return null;
  }

  return userAgent.slice(0, 512);
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashClientIp(ipAddress: string | null): string {
  return hashText(ipAddress ?? "unknown");
}
