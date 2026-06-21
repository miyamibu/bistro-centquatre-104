import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{12,128}$/;

export function validateIdempotencyKey(value: string | null | undefined) {
  const key = value?.trim() ?? "";
  if (!key) {
    return { ok: false as const, code: "MISSING_IDEMPOTENCY_KEY" };
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return { ok: false as const, code: "INVALID_IDEMPOTENCY_KEY" };
  }
  return { ok: true as const, key };
}

export function buildHmacActorKey(scope: string, parts: Array<string | null | undefined>) {
  const secret = env.IDEMPOTENCY_HASH_SECRET ?? env.RATE_LIMIT_HASH_SECRET;
  if (!secret) {
    throw new Error("IDEMPOTENCY_HASH_SECRET_MISSING");
  }

  const hmac = createHmac("sha256", secret);
  hmac.update(scope);
  for (const part of parts) {
    hmac.update("\0");
    hmac.update((part ?? "").trim().toLowerCase());
  }
  return `${scope}:${hmac.digest("hex")}`;
}

export function isIdempotencyKeyEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
