type AuthenticationMethodReference = {
  method?: unknown;
  timestamp?: unknown;
};

/**
 * Return the start of the authenticated session, not the issue time of the
 * latest refreshed access token. Supabase keeps the original authentication
 * method timestamps in the signed `amr` claim across token refreshes.
 */
export function readStaffSessionStartedAt(accessToken: string): number | null {
  try {
    const segment = accessToken.split(".")[1];
    if (!segment) return null;
    const base64 = segment
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(segment.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64)) as { amr?: unknown };
    if (!Array.isArray(payload.amr)) return null;

    const timestamps = (payload.amr as AuthenticationMethodReference[])
      .filter((entry) => entry?.method !== "token_refresh")
      .map((entry) => entry?.timestamp)
      .filter(
        (timestamp): timestamp is number =>
          typeof timestamp === "number" && Number.isSafeInteger(timestamp) && timestamp > 0,
      );

    return timestamps.length > 0 ? Math.min(...timestamps) : null;
  } catch {
    return null;
  }
}
