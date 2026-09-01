import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    getSession: vi.fn(),
    signOut: vi.fn(),
  },
}));

const createServerClientMock = vi.hoisted(() => vi.fn(() => authClient));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

import { middleware } from "@/middleware";

const originalEnv = { ...process.env };

function accessToken(sessionStartedAt = Math.floor(Date.now() / 1000), iat = sessionStartedAt) {
  const payload = Buffer.from(
    JSON.stringify({
      iat,
      amr: [{ method: "password", timestamp: sessionStartedAt }],
    }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function arrangeAuth(options: {
  role?: "STAFF" | "ADMIN";
  sessionStartedAt?: number;
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

  it("rejects missing role and expired sessions", async () => {
    arrangeAuth();
    const roleResponse = await middleware(request("http://localhost:3000/api/admin/reservations"));
    expect(roleResponse.status).toBe(403);
    await expect(roleResponse.json()).resolves.toMatchObject({ code: "STAFF_ROLE_REQUIRED" });

    arrangeAuth({
      role: "STAFF",
      sessionStartedAt: Math.floor(Date.now() / 1000) - 28_801,
    });
    const expiredResponse = await middleware(request("http://localhost:3000/api/admin/reservations"));
    expect(expiredResponse.status).toBe(401);
    await expect(expiredResponse.json()).resolves.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(authClient.auth.signOut).toHaveBeenCalled();
  });

  it("does not extend the absolute staff lifetime when Supabase refreshes the JWT", async () => {
    const now = Math.floor(Date.now() / 1000);
    arrangeAuth({ role: "STAFF", sessionStartedAt: now - 28_801, iat: now });

    const response = await middleware(request("http://localhost:3000/api/admin/reservations"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("passes a password-only staff session and keeps backup export on bearer auth", async () => {
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

  it("allows a password-only staff session on protected routes", async () => {
    arrangeAuth({ role: "ADMIN" });

    const protectedPage = await middleware(request("http://localhost:3000/admin/reservations"));
    expect(protectedPage.status).toBe(200);
  });

  it("does not allow an unprivileged authenticated identity into enrollment pages", async () => {
    arrangeAuth();

    const response = await middleware(request("http://localhost:3000/admin/mfa/setup"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("error=staff_role_required");
  });
});
