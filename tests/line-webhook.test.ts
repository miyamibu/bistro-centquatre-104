import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

// Top-level mock so Vitest can hoist it properly.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    lineFriend: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

const originalEnv = { ...process.env };
const SECRET = "test-line-channel-secret";
const VALID_UID = "U" + "0".repeat(32);

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  vi.clearAllMocks();
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

async function getUpsertMock() {
  const { prisma } = await import("@/lib/prisma");
  return prisma.lineFriend.upsert as ReturnType<typeof vi.fn>;
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

  it("returns 200 and calls upsert FRIEND on follow event", async () => {
    const { POST } = await loadWebhook();
    const upsertMock = await getUpsertMock();

    const body = JSON.stringify({
      destination: "U0",
      events: [{ type: "follow", source: { type: "user", userId: VALID_UID } }],
    });
    const signature = sign(body, SECRET);
    const response = await POST(signedRequest(body, signature));
    expect(response.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledOnce();
    const call = upsertMock.mock.calls[0][0] as { create: { friendshipStatus: string }; update: { friendshipStatus: string } };
    expect(call.create.friendshipStatus).toBe("FRIEND");
    expect(call.update.friendshipStatus).toBe("FRIEND");
  });

  it("returns 200 and calls upsert BLOCKED on unfollow event", async () => {
    const { POST } = await loadWebhook();
    const upsertMock = await getUpsertMock();

    const body = JSON.stringify({
      destination: "U0",
      events: [{ type: "unfollow", source: { type: "user", userId: VALID_UID } }],
    });
    const signature = sign(body, SECRET);
    const response = await POST(signedRequest(body, signature));
    expect(response.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledOnce();
    const call = upsertMock.mock.calls[0][0] as { create: { friendshipStatus: string }; update: { friendshipStatus: string } };
    expect(call.create.friendshipStatus).toBe("BLOCKED");
    expect(call.update.friendshipStatus).toBe("BLOCKED");
  });

  it("returns 400 when a signed body is malformed JSON", async () => {
    const { POST } = await loadWebhook();
    const body = "not-json-at-all";
    const signature = sign(body, SECRET);
    const response = await POST(signedRequest(body, signature));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "LINE_WEBHOOK_MALFORMED_JSON",
    });
  });

  it("returns 413 before processing an oversized body", async () => {
    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [] });
    const signature = sign(body, SECRET);
    const request = new NextRequest("http://localhost:3000/api/line/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-line-signature": signature,
        "content-length": String(129 * 1024),
      },
      body,
    });

    const response = await POST(request);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: "LINE_WEBHOOK_BODY_TOO_LARGE",
    });
  });

  it("does not log the userId into console output on follow event", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { POST } = await loadWebhook();
    const body = JSON.stringify({
      destination: "U0",
      events: [{ type: "follow", source: { userId: VALID_UID } }],
    });
    const signature = sign(body, SECRET);
    await POST(signedRequest(body, signature));

    const allOutput = [...logSpy.mock.calls, ...infoSpy.mock.calls]
      .flat()
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join("\n");

    expect(allOutput).not.toContain(VALID_UID);
    logSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
