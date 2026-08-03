import { NextRequest } from "next/server";
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

const createServerClientMock = vi.hoisted(() => vi.fn(() => authClient));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

import { middleware } from "@/middleware";

const originalEnv = { ...process.env };

function accessToken(iat = Math.floor(Date.now() / 1000)) {
  const payload = Buffer.from(JSON.stringify({ iat }), "utf8").toString("base64url");
  return `header.${payload}.signature`;
}

function arrangeAuth(options: {
  role?: "STAFF" | "ADMIN";
  aal?: "aal1" | "aal2";
  iat?: number;
  user?: boolean;
} = {}) {
  authClient.auth.getUser.mockResolvedValue({
    data: {
      user: options.user === false
        ? null
        : {
            id: "staff-user-1",
            email: "staff@example.com",
            app_metadata: options.role ? { role: options.role } : {},
          },
    },
    error: null,
  });
  authClient.auth.getSession.mockResolvedValue({
    data: { session: { access_token: accessToken(options.iat) } },
    error: null,
  });
  authClient.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: options.aal ?? "aal2" },
    error: null,
  });
  authClient.auth.signOut.mockResolvedValue({ error: null });
}

function request(url: string) {
  return new NextRequest(url, {
    headers: { accept: "text/html" },
  });
}

describe("middleware staff auth boundary", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      STAFF_SESSION_MAX_AGE_SECONDS: "28800",
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("redirects an unauthenticated page request to the staff login", async () => {
    arrangeAuth({ user: false });

    const response = await middleware(request("http://localhost:3000/admin/reservations"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/admin/login?error=unauthorized");
  });

  it("returns machine-readable 401 for an unauthenticated API request", async () => {
    arrangeAuth({ user: false });

    const response = await middleware(request("http://localhost:3000/api/admin/reservations"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects missing role, missing MFA, and expired sessions", async () => {
    arrangeAuth({ aal: "aal2" });
    const roleResponse = await middleware(request("http://localhost:3000/api/admin/reservations"));
    expect(roleResponse.status).toBe(403);
    await expect(roleResponse.json()).resolves.toMatchObject({ code: "STAFF_ROLE_REQUIRED" });

    arrangeAuth({ role: "STAFF", aal: "aal1" });
    const mfaResponse = await middleware(request("http://localhost:3000/api/admin/reservations"));
    expect(mfaResponse.status).toBe(403);
    await expect(mfaResponse.json()).resolves.toMatchObject({ code: "MFA_REQUIRED" });

    arrangeAuth({ role: "STAFF", iat: Math.floor(Date.now() / 1000) - 28_801 });
    const expiredResponse = await middleware(request("http://localhost:3000/api/admin/reservations"));
    expect(expiredResponse.status).toBe(401);
    await expect(expiredResponse.json()).resolves.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(authClient.auth.signOut).toHaveBeenCalled();
  });

  it("passes an enrolled staff session and keeps backup export on bearer auth", async () => {
    arrangeAuth({ role: "STAFF" });
    const protectedResponse = await middleware(request("http://localhost:3000/dashboard/orders"));
    expect(protectedResponse.status).toBe(200);
    expect(protectedResponse.headers.get("Link")).toContain("/agents");

    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const backupResponse = await middleware(
      request("http://localhost:3000/api/admin/backups/reservations/export?date=2026-08-03"),
    );
    expect(backupResponse.status).toBe(200);
    expect(createServerClientMock).not.toHaveBeenCalled();
  });
});
