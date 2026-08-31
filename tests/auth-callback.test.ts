import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { exchangeCodeForSession },
  })),
}));

import { GET } from "@/app/auth/callback/route";

const originalEnv = { ...process.env };

describe("Supabase auth callback", () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    };
    exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("exchanges the PKCE code and redirects to the requested local enrollment path", async () => {
    const response = await GET(
      new NextRequest("https://preview.example/auth/callback?code=valid-code&next=/admin/password-reset"),
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith("valid-code");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://preview.example/admin/password-reset");
  });

  it("rejects protocol-relative next targets and falls back to password reset", async () => {
    const response = await GET(
      new NextRequest("https://preview.example/auth/callback?code=valid-code&next=//evil.example"),
    );

    expect(response.headers.get("location")).toBe("https://preview.example/admin/password-reset");
  });

  it("fails closed when the callback code is missing", async () => {
    const response = await GET(new NextRequest("https://preview.example/auth/callback"));

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://preview.example/admin/login?error=invalid_callback",
    );
  });
});
