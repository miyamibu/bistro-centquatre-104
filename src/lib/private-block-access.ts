import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";

export const PRIVATE_BLOCK_ACCESS_MISSING_CODE = "PRIVATE_BLOCK_ACCESS_NOT_CONFIGURED";
export const PRIVATE_BLOCK_ACCESS_DENIED_CODE = "PRIVATE_BLOCK_ACCESS_DENIED";

function normalize(value: string) {
  return value.trim();
}

export function hasPrivateBlockAccessCode() {
  return Boolean(env.PRIVATE_BLOCK_ACCESS_CODE);
}

export function verifyPrivateBlockAccessCode(input?: string | null): boolean {
  if (!env.PRIVATE_BLOCK_ACCESS_CODE || typeof input !== "string") {
    return false;
  }

  const expected = Buffer.from(normalize(env.PRIVATE_BLOCK_ACCESS_CODE), "utf8");
  const provided = Buffer.from(normalize(input), "utf8");

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}
