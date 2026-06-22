import { createHmac } from "crypto";
import type { NextRequest } from "next/server";

const DEV_RATE_LIMIT_HASH_SECRET = "dev-rate-limit-hash-secret";

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

function getRateLimitHashSecret(): string {
  const secret = process.env.RATE_LIMIT_HASH_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("RATE_LIMIT_HASH_SECRET is required in production");
  }

  return DEV_RATE_LIMIT_HASH_SECRET;
}

export function hashText(value: string, purpose = "generic"): string {
  return createHmac("sha256", getRateLimitHashSecret())
    .update(`bistro:${purpose}:${value}`)
    .digest("hex");
}

export function hashClientIp(ipAddress: string | null): string {
  return hashText(ipAddress ?? "unknown", "rate-limit-ip");
}
