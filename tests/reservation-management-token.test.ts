import { describe, expect, it, vi } from "vitest";
import {
  buildReservationManagementUrl,
  generateReservationManagementToken,
  hashReservationManagementToken,
  issueReservationManagementToken,
  resolveReservationManagementBaseUrl,
  RESERVATION_MANAGEMENT_TOKEN_TTL_MS,
} from "@/lib/reservation-management-token";

describe("reservation management token", () => {
  it("generates a URL-safe token and stores only its digest", async () => {
    const create = vi.fn().mockResolvedValue({ id: "management-token-1" });
    const tx = { reservationManagementToken: { create } };
    const now = new Date("2026-07-31T00:00:00.000Z");

    const issued = await issueReservationManagementToken(
      tx as never,
      "reservation-1",
      "idempotency-1",
      now,
    );

    expect(issued.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(create).toHaveBeenCalledWith({
      data: {
        reservationId: "reservation-1",
        tokenHash: hashReservationManagementToken(issued.rawToken),
        keyId: "v1",
        expiresAt: new Date(now.getTime() + RESERVATION_MANAGEMENT_TOKEN_TTL_MS),
      },
    });
    expect(create.mock.calls[0][0].data.tokenHash).not.toBe(issued.rawToken);
  });

  it("derives the same raw token for an idempotent replay without storing it", async () => {
    const create = vi.fn().mockResolvedValue({ id: "management-token-1" });
    const tx = { reservationManagementToken: { create } };
    const now = new Date("2026-07-31T00:00:00.000Z");

    const first = await issueReservationManagementToken(
      tx as never,
      "reservation-1",
      "idempotency-1",
      now,
    );
    const replay = await issueReservationManagementToken(
      tx as never,
      "reservation-1",
      "idempotency-1",
      now,
    );

    expect(replay.rawToken).toBe(first.rawToken);
  });

  it("keeps the bearer token in a URL fragment instead of the query string", () => {
    const token = generateReservationManagementToken();
    const url = buildReservationManagementUrl("https://example.test/", token);
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/reservation/manage");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe(`#token=${encodeURIComponent(token)}`);
  });

  it("prefers the current Netlify deploy origin for preview-safe management links", () => {
    vi.stubEnv("DEPLOY_PRIME_URL", "https://deploy-preview-2--bistro.example/some-path");
    vi.stubEnv("BASE_URL", "https://bistro.example");

    expect(resolveReservationManagementBaseUrl("http://localhost:3000")).toBe(
      "https://deploy-preview-2--bistro.example",
    );

    vi.unstubAllEnvs();
  });
});
