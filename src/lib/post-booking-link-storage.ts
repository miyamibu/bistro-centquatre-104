// Client-only short-term storage for the post-booking LINE link claim token.
//
// Why this exists:
//   When a reservation is created without LINE linking, the server returns a
//   plain claim token (lineClaimToken) in the response. The user then taps the
//   "LINEで通知を受け取る" button. If `liff.isLoggedIn()` is false, the LIFF SDK
//   triggers a navigation/redirect to the LINE login flow. After auth the user
//   returns to /booking, but React in-memory state (reservationId, claim token)
//   is lost. Without persistence the post-booking link cannot resume.
//
// Why sessionStorage and not localStorage:
//   - sessionStorage is cleared when the tab is closed → natural cleanup
//   - localStorage would persist across sessions → unnecessary risk
//
// Security:
//   - Same-origin JS can read the value. There is no cross-origin leak.
//   - The plain claim token is stored, but it is single-use and has a 1h server
//     TTL (LINE_CLAIM_TOKEN_TTL_MS). Once the server consumes it, future use
//     returns 410.
//   - The storage key namespace `bistro:post-booking-link` is intentional to
//     scope the value clearly.
//   - SSR-safe: every accessor checks for window/sessionStorage availability.

const STORAGE_KEY = "bistro:post-booking-link";

export interface PostBookingLinkRecord {
  reservationId: string;
  claimToken: string;
  /** Epoch milliseconds, computed client-side at submit time. */
  expiresAtMs: number;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    // Touching window.sessionStorage in some environments (e.g. cross-origin
    // iframes or strict privacy modes) can throw. Wrap accessor in try/catch.
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function isValidRecord(value: unknown): value is PostBookingLinkRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (typeof r.reservationId !== "string" || r.reservationId.length < 1) return false;
  if (typeof r.claimToken !== "string" || r.claimToken.length < 20) return false;
  if (typeof r.expiresAtMs !== "number" || !Number.isFinite(r.expiresAtMs)) return false;
  return true;
}

/**
 * Persist the post-booking link record. Silently no-ops in non-browser
 * environments or when storage is unavailable.
 */
export function storePostBookingLink(record: PostBookingLinkRecord): void {
  const storage = getStorage();
  if (!storage) return;
  if (!isValidRecord(record)) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // QuotaExceededError or other; best-effort only
  }
}

/**
 * Restore the post-booking link record from sessionStorage.
 *
 * Returns `null` and clears the slot when:
 *   - storage is unavailable (SSR / privacy mode)
 *   - the value is missing
 *   - the value is unparseable JSON
 *   - the record fails shape validation
 *   - the record has expired (expiresAtMs <= now)
 */
export function restorePostBookingLink(
  nowMs: number = Date.now()
): PostBookingLinkRecord | null {
  const storage = getStorage();
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Clear unparseable junk
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
  if (!isValidRecord(parsed)) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
  if (parsed.expiresAtMs <= nowMs) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
  return parsed;
}

/**
 * Clear the stored post-booking link record. Idempotent and SSR-safe.
 */
export function clearPostBookingLink(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Exported for tests only.
export const POST_BOOKING_LINK_STORAGE_KEY = STORAGE_KEY;
