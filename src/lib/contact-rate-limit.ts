import { hashText } from "@/lib/request-meta";
import { supabaseServer } from "@/lib/supabase-server";

export const CONTACT_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
export const CONTACT_RATE_LIMIT_IP_MAX = 5;
export const CONTACT_RATE_LIMIT_EMAIL_MAX = 3;

export class ContactRateLimitExceededError extends Error {
  readonly code = "CONTACT_RATE_LIMITED";

  constructor() {
    super("お問い合わせが集中しています。時間をおいて再試行してください。");
    this.name = "ContactRateLimitExceededError";
  }
}

export class ContactRateLimitUnavailableError extends Error {
  readonly code = "CONTACT_RATE_LIMIT_UNAVAILABLE";

  constructor(message = "Contact rate limit storage is unavailable") {
    super(message);
    this.name = "ContactRateLimitUnavailableError";
  }
}

export function isContactRateLimitExceededError(error: unknown): error is ContactRateLimitExceededError {
  return error instanceof ContactRateLimitExceededError;
}

export function isContactRateLimitUnavailableError(
  error: unknown,
): error is ContactRateLimitUnavailableError {
  return error instanceof ContactRateLimitUnavailableError;
}

export async function enforceContactRateLimit(input: {
  ipAddress: string | null;
  email: string;
  now?: Date;
}) {
  const { data, error } = await supabaseServer.rpc("consume_contact_rate_limit", {
    p_ip_hash: hashText(input.ipAddress ?? "unknown", "contact-rate-limit-ip"),
    p_email_hash: hashText(input.email.trim().toLowerCase(), "contact-rate-limit-email"),
    p_window_seconds: CONTACT_RATE_LIMIT_WINDOW_SECONDS,
    p_ip_max_requests: CONTACT_RATE_LIMIT_IP_MAX,
    p_email_max_requests: CONTACT_RATE_LIMIT_EMAIL_MAX,
    p_now: (input.now ?? new Date()).toISOString(),
  });

  if (error || typeof data !== "boolean") {
    throw new ContactRateLimitUnavailableError(error?.message);
  }

  if (!data) {
    throw new ContactRateLimitExceededError();
  }
}
