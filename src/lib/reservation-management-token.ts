import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  deriveReservationScopedToken,
  getActiveReservationTokenKeyId,
} from "@/lib/reservation-token";

export const RESERVATION_MANAGEMENT_PATH = "/reservation/manage";
export const RESERVATION_MANAGEMENT_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const RESERVATION_MANAGEMENT_TOKEN_MIN_LENGTH = 20;
export const RESERVATION_MANAGEMENT_TOKEN_MAX_LENGTH = 128;

/** Generate an ad-hoc 256-bit bearer token. The raw value must never be logged or persisted. */
export function generateReservationManagementToken() {
  return randomBytes(32).toString("base64url");
}

/** Store only a deterministic digest; the raw bearer token is returned only to the customer. */
export function hashReservationManagementToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function isReservationManagementTokenFormatValid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= RESERVATION_MANAGEMENT_TOKEN_MIN_LENGTH &&
    value.length <= RESERVATION_MANAGEMENT_TOKEN_MAX_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function buildReservationManagementUrl(baseUrl: string, rawToken: string) {
  return `${baseUrl.replace(/\/+$/, "")}${RESERVATION_MANAGEMENT_PATH}#token=${encodeURIComponent(rawToken)}`;
}

/** Prefer the current Netlify deploy origin so Preview links stay in their own isolated context. */
export function resolveReservationManagementBaseUrl(fallback?: string) {
  const candidates = [
    process.env.DEPLOY_PRIME_URL,
    process.env.BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    fallback,
  ];

  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      const url = new URL(candidate.trim());
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      // Continue to the next explicitly configured fallback.
    }
  }

  return null;
}

export async function issueReservationManagementToken(
  tx: Prisma.TransactionClient,
  reservationId: string,
  idempotencyKey: string,
  now = new Date()
) {
  const rawToken = deriveReservationScopedToken(
    "management",
    reservationId,
    idempotencyKey,
  );
  const keyId = getActiveReservationTokenKeyId();
  const expiresAt = new Date(now.getTime() + RESERVATION_MANAGEMENT_TOKEN_TTL_MS);

  await tx.reservationManagementToken.create({
    data: {
      reservationId,
      tokenHash: hashReservationManagementToken(rawToken),
      keyId,
      expiresAt,
    },
  });

  return { rawToken, expiresAt, keyId };
}
