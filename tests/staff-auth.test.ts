import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    getSession: vi.fn(),
    signOut: vi.fn(),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(),
    },
  },
}));

const authEnv = vi.hoisted(() => ({ STAFF_SESSION_MAX_AGE_SECONDS: 28_800 }));

vi.mock("@/lib/supabase-auth-server", () => ({
  createSupabaseAuthServerClient: vi.fn(async () => authClient),
}));

vi.mock("@/lib/env", () => ({ env: authEnv }));

import { getStaffAuth, hasStaffRole } from "@/lib/staff-auth";

function accessToken(sessionStartedAt: number, iat = sessionStartedAt) {
  const payload = Buffer.from(
    JSON.stringify({
      iat,
      amr: [
        { method: "password", timestamp: sessionStartedAt },
        { method: "totp", timestamp: sessionStartedAt + 1 },
      ],
    }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function user(role?: string) {
  return {
    id: "staff-user-1",
    email: "staff@example.com",
    app_metadata: role ? { role } : {},
  };
}

function arrangeAuth(options: {
  role?: string;
  sessionStartedAt?: number;
  iat?: number;
  aal?: "aal1" | "aal2";
} = {}) {
  authClient.auth.getUser.mockResolvedValue({ data: { user: user(options.role) }, error: null });
  authClient.auth.getSession.mockResolvedValue({
    data: {
      session: {
        access_token: accessToken(
          options.sessionStartedAt ?? Math.floor(Date.now() / 1000),
          options.iat,
        ),
      },
    },
    error: null,
  });
  authClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: options.aal ?? "aal2", nextLevel: "aal2" },
    error: null,
  });
  authClient.auth.signOut.mockResolvedValue({ error: null });
}

describe("individual staff authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authEnv.STAFF_SESSION_MAX_AGE_SECONDS = 28_800;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a STAFF user with aal2 and returns the authenticated identity", async () => {
    arrangeAuth({ role: "STAFF" });

    await expect(getStaffAuth()).resolves.toMatchObject({
      userId: "staff-user-1",
      email: "staff@example.com",
      role: "STAFF",
      aal: "aal2",
    });
    expect(authClient.auth.mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalledOnce();
  });

  it("allows ADMIN on ADMIN routes but rejects STAFF", async () => {
    arrangeAuth({ role: "ADMIN" });
    await expect(getStaffAuth("ADMIN")).resolves.toMatchObject({ role: "ADMIN" });

    arrangeAuth({ role: "STAFF" });
    await expect(getStaffAuth("ADMIN")).resolves.toBeNull();
  });

  it("rejects missing role and aal1 sessions", async () => {
    arrangeAuth();
    await expect(getStaffAuth()).resolves.toBeNull();

    arrangeAuth({ role: "STAFF", aal: "aal1" });
    await expect(getStaffAuth()).resolves.toBeNull();
  });

  it("signs out and rejects a session older than the configured TTL", async () => {
    authEnv.STAFF_SESSION_MAX_AGE_SECONDS = 60;
    arrangeAuth({ role: "STAFF", sessionStartedAt: Math.floor(Date.now() / 1000) - 61 });

    await expect(getStaffAuth()).resolves.toBeNull();
    expect(authClient.auth.signOut).toHaveBeenCalledOnce();
  });

  it("uses the AMR login timestamp instead of a refreshed JWT issue time", async () => {
    const now = Math.floor(Date.now() / 1000);
    authEnv.STAFF_SESSION_MAX_AGE_SECONDS = 60;
    arrangeAuth({ role: "STAFF", sessionStartedAt: now - 61, iat: now });

    await expect(getStaffAuth()).resolves.toBeNull();
    expect(authClient.auth.signOut).toHaveBeenCalledOnce();
  });

  it("keeps role comparison fail-closed", () => {
    expect(hasStaffRole("ADMIN", "STAFF")).toBe(true);
    expect(hasStaffRole("STAFF", "STAFF")).toBe(true);
    expect(hasStaffRole("STAFF", "ADMIN")).toBe(false);
  });
});
