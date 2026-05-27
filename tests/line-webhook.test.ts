import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

const originalEnv = { ...process.env };
const SECRET = "test-line-channel-secret";

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

async function loadWebhook() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.LINE_CHANNEL_SECRET = SECRET;
  return import("@/app/api/line/webhook/route");
}

function signedRequest(body: string, signature: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/line/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-line-signature": signature,
    },
    body,
  });
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

describe("/api/line/webhook", () => {
  it("returns 200 for a correctly signed body", async () => {
    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [] });
    const signature = sign(body, SECRET);
    const response = await POST(signedRequest(body, signature));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("returns 401 for an invalid signature", async () => {
    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [] });
    const signature = sign(body, "wrong-secret");
    const response = await POST(signedRequest(body, signature));
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.code).toBe("LINE_SIGNATURE_INVALID");
  });

  it("returns 401 when signature header is missing", async () => {
    const { POST } = await loadWebhook();
    const request = new NextRequest("http://localhost:3000/api/line/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 503 when LINE_CHANNEL_SECRET is not configured", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    delete process.env.LINE_CHANNEL_SECRET;
    const { POST } = await import("@/app/api/line/webhook/route");
    const response = await POST(signedRequest("{}", "sig"));
    expect(response.status).toBe(503);
  });
});
