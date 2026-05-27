import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const VALID_SUB = "U" + "0".repeat(32);

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

function buildRequest(reservationId: string, body: unknown) {
  return new NextRequest(
    `http://localhost:3000/api/reservations/${encodeURIComponent(reservationId)}/line-link`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify(body ?? {}),
    }
  );
}

type ReservationMock = {
  id: string;
  status: string;
  lineUserId: string | null;
  lineClaimTokenHash: string | null;
  lineClaimExpiresAt: Date | null;
  lineConfirmationSentAt: Date | null;
  date: string;
  arrivalTime: string | null;
  partySize: number;
};

const baseReservation = (overrides: Partial<ReservationMock> = {}): ReservationMock => ({
  id: "res-1",
  status: "CONFIRMED",
  lineUserId: null,
  lineClaimTokenHash: null,
  lineClaimExpiresAt: null,
  lineConfirmationSentAt: null,
  date: "2026-12-31",
  arrivalTime: "18:00",
  partySize: 2,
  ...overrides,
});

interface PrismaMockState {
  reservation: ReservationMock | null;
  findUniqueCalls: number;
  updateManyCalls: number;
  updateManyReturn: { count: number };
  updateManyArgs: unknown[];
}

function setupPrismaMock(state: PrismaMockState) {
  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      reservation: {
        findUnique: vi.fn(async () => {
          state.findUniqueCalls += 1;
          return state.reservation;
        }),
        updateMany: vi.fn(async (args: unknown) => {
          state.updateManyCalls += 1;
          state.updateManyArgs.push(args);
          if (state.updateManyReturn.count > 0 && state.reservation) {
            // simulate successful update by mutating state
            state.reservation = {
              ...state.reservation,
              lineUserId: VALID_SUB,
              lineConfirmationSentAt: new Date(),
              lineClaimTokenHash: null,
              lineClaimExpiresAt: null,
            };
          }
          return state.updateManyReturn;
        }),
      },
    },
  }));
}

function setupSchemaReady() {
  vi.doMock("@/lib/reservation-compat", async () => {
    const actual = await vi.importActual<typeof import("@/lib/reservation-compat")>(
      "@/lib/reservation-compat"
    );
    return {
      ...actual,
      ensureReservationSchemaReady: vi.fn(async () => {}),
    };
  });
}

async function loadModuleAndHelpers() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.LINE_LOGIN_CHANNEL_ID = "channel-A";
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-access-token";
  const line = await import("@/lib/line");
  return { line };
}

// Helper: an expiry exactly at the TTL boundary (1h after now per current TTL).
// Tests use this so the active-claim cases stay valid for the full TTL window
// without relying on a magic literal.
function inWindowExpiry(line: { LINE_CLAIM_TOKEN_TTL_MS: number }): Date {
  return new Date(Date.now() + line.LINE_CLAIM_TOKEN_TTL_MS);
}

describe("/api/reservations/[id]/line-link", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("returns 404 when reservation does not exist", async () => {
    setupSchemaReady();
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        reservation: {
          findUnique: vi.fn(async () => null),
          updateMany: vi.fn(async () => ({ count: 0 })),
        },
      },
    }));
    await loadModuleAndHelpers();
    const { POST } = await import("@/app/api/reservations/[id]/line-link/route");
    const res = await POST(
      buildRequest("nope", { claimToken: "a".repeat(40), lineIdToken: "x.y.z" }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(res.status).toBe(404);
  });

  it("rejects invalid claim token with 403 and does not call LINE verify or DB update", async () => {
    setupSchemaReady();
    const { line } = await loadModuleAndHelpers();
    const { hash: storedHash } = line.generateLineClaimToken();
    const state: PrismaMockState = {
      reservation: baseReservation({
        lineClaimTokenHash: storedHash,
        lineClaimExpiresAt: inWindowExpiry(line),
      }),
      findUniqueCalls: 0,
      updateManyCalls: 0,
      updateManyReturn: { count: 0 },
      updateManyArgs: [],
    };
    setupPrismaMock(state);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/reservations/[id]/line-link/route");
    const res = await POST(
      buildRequest("res-1", { claimToken: "wrong-token-which-is-long-enough", lineIdToken: "x.y.z" }),
      { params: Promise.resolve({ id: "res-1" }) }
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("LINE_CLAIM_TOKEN_INVALID");
    expect(state.updateManyCalls).toBe(0);
    // no LINE API was called
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects expired claim with 410", async () => {
    setupSchemaReady();
    const { line } = await loadModuleAndHelpers();
    const { plain, hash } = line.generateLineClaimToken();
    const state: PrismaMockState = {
      reservation: baseReservation({
        lineClaimTokenHash: hash,
        lineClaimExpiresAt: new Date(Date.now() - 1000),
      }),
      findUniqueCalls: 0,
      updateManyCalls: 0,
      updateManyReturn: { count: 0 },
      updateManyArgs: [],
    };
    setupPrismaMock(state);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/reservations/[id]/line-link/route");
    const res = await POST(
      buildRequest("res-1", { claimToken: plain, lineIdToken: "x.y.z" }),
      { params: Promise.resolve({ id: "res-1" }) }
    );
    expect(res.status).toBe(410);
    expect(state.updateManyCalls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("idempotent: when reservation is already linked returns 200 and does NOT call fetch/LINE", async () => {
    setupSchemaReady();
    const { line } = await loadModuleAndHelpers();
    const { plain, hash } = line.generateLineClaimToken();
    const state: PrismaMockState = {
      reservation: baseReservation({
        lineUserId: VALID_SUB,
        lineClaimTokenHash: hash,
        lineClaimExpiresAt: inWindowExpiry(line),
        lineConfirmationSentAt: new Date(Date.now() - 60_000),
      }),
      findUniqueCalls: 0,
      updateManyCalls: 0,
      updateManyReturn: { count: 0 },
      updateManyArgs: [],
    };
    setupPrismaMock(state);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/reservations/[id]/line-link/route");
    const res = await POST(
      buildRequest("res-1", { claimToken: plain, lineIdToken: "x.y.z" }),
      { params: Promise.resolve({ id: "res-1" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyLinked).toBe(true);
    expect(body.lineNotification.enabled).toBe(true);
    expect(state.updateManyCalls).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("successful link: verifies LINE ID token, confirms pushable, updates DB, and sends ONE confirmation push", async () => {
    setupSchemaReady();
    const { line } = await loadModuleAndHelpers();
    const { plain, hash } = line.generateLineClaimToken();
    const state: PrismaMockState = {
      reservation: baseReservation({
        lineClaimTokenHash: hash,
        lineClaimExpiresAt: inWindowExpiry(line),
      }),
      findUniqueCalls: 0,
      updateManyCalls: 0,
      updateManyReturn: { count: 1 },
      updateManyArgs: [],
    };
    setupPrismaMock(state);

    const pushCalls: { url: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/oauth2/v2.1/verify")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            iss: "https://access.line.me",
            aud: "channel-A",
            sub: VALID_SUB,
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
          text: async () => "",
          headers: new Headers(),
        } as unknown as Response;
      }
      if (input.includes("/v2/bot/profile/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ displayName: "n/a" }),
          text: async () => "",
          headers: new Headers(),
        } as unknown as Response;
      }
      if (input.includes("/v2/bot/message/push")) {
        pushCalls.push({ url: input, body: init?.body });
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => "",
          headers: new Headers({ "x-line-request-id": "req-1" }),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "",
        headers: new Headers(),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/reservations/[id]/line-link/route");
    const res = await POST(
      buildRequest("res-1", { claimToken: plain, lineIdToken: "x.y.z" }),
      { params: Promise.resolve({ id: "res-1" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyLinked).toBe(false);
    expect(body.lineNotification.enabled).toBe(true);
    expect(body.lineNotification.confirmationSent).toBe(true);
    // DB was updated once and only once
    expect(state.updateManyCalls).toBe(1);
    // Push was called exactly once
    expect(pushCalls).toHaveLength(1);
    // The update used the matching claim hash and the (verified) sub
    const updateArgs = state.updateManyArgs[0] as { where: unknown; data: unknown };
    expect(updateArgs.where).toMatchObject({
      id: "res-1",
      status: "CONFIRMED",
      lineUserId: null,
      lineClaimTokenHash: hash,
    });
    expect(updateArgs.data).toMatchObject({
      lineUserId: VALID_SUB,
      lineClaimTokenHash: null,
      lineClaimExpiresAt: null,
    });
    // Push body does NOT include phone/name/note
    const pushBody = String(pushCalls[0].body ?? "");
    expect(pushBody).toContain("ご予約を承りました");
    expect(pushBody).not.toMatch(/090|080|070|アレルギー|要望|電話番号/);
  });

  it("invalid LINE ID token => 400 LINE_VERIFY_FAILED and DB is not updated", async () => {
    setupSchemaReady();
    const { line } = await loadModuleAndHelpers();
    const { plain, hash } = line.generateLineClaimToken();
    const state: PrismaMockState = {
      reservation: baseReservation({
        lineClaimTokenHash: hash,
        lineClaimExpiresAt: inWindowExpiry(line),
      }),
      findUniqueCalls: 0,
      updateManyCalls: 0,
      updateManyReturn: { count: 1 },
      updateManyArgs: [],
    };
    setupPrismaMock(state);
    // verify endpoint returns an aud that does not match LINE_LOGIN_CHANNEL_ID
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/oauth2/v2.1/verify")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ iss: "https://access.line.me", aud: "different", sub: VALID_SUB }),
          text: async () => "",
          headers: new Headers(),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "",
        headers: new Headers(),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/reservations/[id]/line-link/route");
    const res = await POST(
      buildRequest("res-1", { claimToken: plain, lineIdToken: "x.y.z" }),
      { params: Promise.resolve({ id: "res-1" }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("LINE_VERIFY_FAILED");
    expect(state.updateManyCalls).toBe(0);
  });

  it("not pushable => 422 LINE_NOT_PUSHABLE and DB is not updated", async () => {
    setupSchemaReady();
    const { line } = await loadModuleAndHelpers();
    const { plain, hash } = line.generateLineClaimToken();
    const state: PrismaMockState = {
      reservation: baseReservation({
        lineClaimTokenHash: hash,
        lineClaimExpiresAt: inWindowExpiry(line),
      }),
      findUniqueCalls: 0,
      updateManyCalls: 0,
      updateManyReturn: { count: 1 },
      updateManyArgs: [],
    };
    setupPrismaMock(state);
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/oauth2/v2.1/verify")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            iss: "https://access.line.me",
            aud: "channel-A",
            sub: VALID_SUB,
          }),
          text: async () => "",
          headers: new Headers(),
        } as unknown as Response;
      }
      if (input.includes("/v2/bot/profile/")) {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => "",
          headers: new Headers(),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "",
        headers: new Headers(),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/reservations/[id]/line-link/route");
    const res = await POST(
      buildRequest("res-1", { claimToken: plain, lineIdToken: "x.y.z" }),
      { params: Promise.resolve({ id: "res-1" }) }
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("LINE_NOT_PUSHABLE");
    expect(state.updateManyCalls).toBe(0);
  });

  it("does not leak claimToken or lineIdToken in console output", async () => {
    setupSchemaReady();
    const { line } = await loadModuleAndHelpers();
    const { plain, hash } = line.generateLineClaimToken();
    const state: PrismaMockState = {
      reservation: baseReservation({
        lineClaimTokenHash: hash,
        lineClaimExpiresAt: inWindowExpiry(line),
      }),
      findUniqueCalls: 0,
      updateManyCalls: 0,
      updateManyReturn: { count: 1 },
      updateManyArgs: [],
    };
    setupPrismaMock(state);
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/oauth2/v2.1/verify")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            iss: "https://access.line.me",
            aud: "channel-A",
            sub: VALID_SUB,
          }),
          text: async () => "",
          headers: new Headers(),
        } as unknown as Response;
      }
      if (input.includes("/v2/bot/profile/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => "",
          headers: new Headers(),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => "",
        headers: new Headers({ "x-line-request-id": "req-1" }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { POST } = await import("@/app/api/reservations/[id]/line-link/route");
    await POST(
      buildRequest("res-1", { claimToken: plain, lineIdToken: "DO-NOT-LOG-THIS-TOKEN" }),
      { params: Promise.resolve({ id: "res-1" }) }
    );

    const all = [
      ...logSpy.mock.calls,
      ...errorSpy.mock.calls,
      ...warnSpy.mock.calls,
    ]
      .flat()
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join("\n");
    expect(all).not.toContain(plain);
    expect(all).not.toContain("DO-NOT-LOG-THIS-TOKEN");
  });
});
