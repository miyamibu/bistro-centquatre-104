import { createHmac } from "node:crypto";

const DEVELOPMENT_RESERVATION_TOKEN_SECRET =
  "development-reservation-token-secret-do-not-use-in-production";

export type ReservationTokenKeyId = string;

type ReservationTokenKeyring = {
  activeKeyId: ReservationTokenKeyId;
  keys: Record<ReservationTokenKeyId, string>;
};

function isUsableSecret(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 32;
}

function getReservationTokenKeyring(): ReservationTokenKeyring {
  const keyringRaw = process.env.RESERVATION_TOKEN_KEYS_JSON?.trim();
  if (keyringRaw) {
    try {
      const parsed = JSON.parse(keyringRaw) as Record<string, unknown>;
      const keys = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => isUsableSecret(value)),
      ) as Record<string, string>;
      const activeKeyId = process.env.RESERVATION_TOKEN_ACTIVE_KEY_ID?.trim() || "v1";
      if (!keys[activeKeyId]) {
        throw new Error("RESERVATION_TOKEN_ACTIVE_KEY_ID is not present in the keyring");
      }
      return { activeKeyId, keys };
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `RESERVATION_TOKEN_KEYS_JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  const legacySecret = process.env.RESERVATION_TOKEN_SECRET?.trim();
  if (isUsableSecret(legacySecret)) {
    return { activeKeyId: "v1", keys: { v1: legacySecret } };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("RESERVATION_TOKEN_SECRET or RESERVATION_TOKEN_KEYS_JSON is required in production");
  }

  return { activeKeyId: "v1", keys: { v1: DEVELOPMENT_RESERVATION_TOKEN_SECRET } };
}

/**
 * Derive a 256-bit URL-safe bearer token without persisting its raw value.
 * Purpose separation prevents one token class from being reused as another.
 */
export function deriveReservationScopedToken(
  purpose: "management" | "line-link",
  reservationId: string,
  idempotencyKey: string,
  keyId?: ReservationTokenKeyId,
) {
  const keyring = getReservationTokenKeyring();
  const selectedKeyId = keyId ?? keyring.activeKeyId;
  const secret = keyring.keys[selectedKeyId];
  if (!secret) {
    throw new Error(`Reservation token key is not available: ${selectedKeyId}`);
  }
  const message = JSON.stringify([
    "bistro-reservation-token",
    1,
    purpose,
    reservationId,
    idempotencyKey,
  ]);
  return createHmac("sha256", secret)
    .update(message, "utf8")
    .digest("base64url");
}

export function getActiveReservationTokenKeyId() {
  return getReservationTokenKeyring().activeKeyId;
}
