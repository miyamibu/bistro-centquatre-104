import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

const webhookMocks = vi.hoisted(() => ({
  lineFriendUpsert: vi.fn(),
  inboxCreate: vi.fn(),
  inboxFindUnique: vi.fn(),
  inboxUpdateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lineFriend: {
      upsert: webhookMocks.lineFriendUpsert,
    },
    lineWebhookInbox: {
      create: webhookMocks.inboxCreate,
      findUnique: webhookMocks.inboxFindUnique,
      updateMany: webhookMocks.inboxUpdateMany,
    },
  },
}));

const originalEnv = { ...process.env };
const SECRET = "test-line-channel-secret";
const VALID_UID = "U" + "0".repeat(32);

function resetWebhookMocks() {
  webhookMocks.lineFriendUpsert.mockReset();
  webhookMocks.lineFriendUpsert.mockResolvedValue({});
  webhookMocks.inboxCreate.mockReset();
  webhookMocks.inboxCreate.mockResolvedValue({ id: "inbox-1", status: "PENDING" });
  webhookMocks.inboxFindUnique.mockReset();
  webhookMocks.inboxFindUnique.mockResolvedValue({ id: "inbox-1", status: "PENDING" });
  webhookMocks.inboxUpdateMany.mockReset();
  webhookMocks.inboxUpdateMany.mockResolvedValue({ count: 1 });
}

resetWebhookMocks();

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  resetWebhookMocks();
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

function event(type: string, webhookEventId: string, withUser = true) {
  return {
    type,
    webhookEventId,
    ...(withUser ? { source: { type: "user", userId: VALID_UID } } : {}),
  };
}

describe("/api/line/webhook", () => {
  it("returns 200 for a correctly signed body with no events", async () => {
    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [] });
    const response = await POST(signedRequest(body, sign(body, SECRET)));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("returns 401 for an invalid signature", async () => {
    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [] });
    const response = await POST(signedRequest(body, sign(body, "wrong-secret")));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "LINE_SIGNATURE_INVALID" });
  });

  it("returns 401 when signature header is missing", async () => {
    const { POST } = await loadWebhook();
    const request = new NextRequest("http://localhost:3000/api/line/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect((await POST(request)).status).toBe(401);
  });

  it("returns 503 when LINE_CHANNEL_SECRET is not configured", async () => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
    delete process.env.LINE_CHANNEL_SECRET;
    const { POST } = await import("@/app/api/line/webhook/route");

    expect((await POST(signedRequest("{}", "sig"))).status).toBe(503);
  });

  it("stores the event before handling follow and marks it processed", async () => {
    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [event("follow", "evt-follow")] });
    const response = await POST(signedRequest(body, sign(body, SECRET)));

    expect(response.status).toBe(200);
    expect(webhookMocks.inboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventId: "evt-follow", eventType: "follow" }),
      })
    );
    expect(webhookMocks.lineFriendUpsert).toHaveBeenCalledOnce();
    expect(webhookMocks.inboxCreate.mock.invocationCallOrder[0]).toBeLessThan(
      webhookMocks.lineFriendUpsert.mock.invocationCallOrder[0]
    );
    expect(webhookMocks.inboxUpdateMany).toHaveBeenCalledTimes(2);
    expect(webhookMocks.inboxUpdateMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PROCESSED" }),
      })
    );
  });

  it("handles unfollow as BLOCKED", async () => {
    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [event("unfollow", "evt-unfollow")] });
    const response = await POST(signedRequest(body, sign(body, SECRET)));

    expect(response.status).toBe(200);
    const call = webhookMocks.lineFriendUpsert.mock.calls[0][0] as {
      create: { friendshipStatus: string };
      update: { friendshipStatus: string };
    };
    expect(call.create.friendshipStatus).toBe("BLOCKED");
    expect(call.update.friendshipStatus).toBe("BLOCKED");
  });

  it("returns 400 for a signed event without webhookEventId", async () => {
    const { POST } = await loadWebhook();
    const body = JSON.stringify({
      destination: "U0",
      events: [{ type: "follow", source: { userId: VALID_UID } }],
    });
    const response = await POST(signedRequest(body, sign(body, SECRET)));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "LINE_WEBHOOK_EVENT_ID_REQUIRED",
    });
    expect(webhookMocks.inboxCreate).not.toHaveBeenCalled();
  });

  it("returns 200 without rerunning a processed duplicate event", async () => {
    webhookMocks.inboxCreate.mockRejectedValue({ code: "P2002" });
    webhookMocks.inboxFindUnique.mockResolvedValue({ id: "inbox-1", status: "PROCESSED" });

    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [event("follow", "evt-duplicate")] });
    const response = await POST(signedRequest(body, sign(body, SECRET)));

    expect(response.status).toBe(200);
    expect(webhookMocks.lineFriendUpsert).not.toHaveBeenCalled();
    expect(webhookMocks.inboxUpdateMany).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when inbox persistence fails", async () => {
    webhookMocks.inboxCreate.mockRejectedValue(new Error("database unavailable"));

    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [event("follow", "evt-db-failure")] });
    const response = await POST(signedRequest(body, sign(body, SECRET)));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "LINE_WEBHOOK_RETRY" });
    expect(webhookMocks.lineFriendUpsert).not.toHaveBeenCalled();
  });

  it("returns retryable 503 when one handler fails and still attempts later events", async () => {
    webhookMocks.lineFriendUpsert.mockRejectedValueOnce(new Error("handler failed"));

    const { POST } = await loadWebhook();
    const body = JSON.stringify({
      destination: "U0",
      events: [event("follow", "evt-partial-1"), event("unfollow", "evt-partial-2")],
    });
    const response = await POST(signedRequest(body, sign(body, SECRET)));

    expect(response.status).toBe(503);
    expect(webhookMocks.lineFriendUpsert).toHaveBeenCalledTimes(2);
    expect(webhookMocks.inboxUpdateMany).toHaveBeenCalledTimes(4);
    expect(webhookMocks.inboxUpdateMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", lastError: "PROCESSING_FAILED" }),
      })
    );
  });

  it("returns 400 when a signed body is malformed JSON", async () => {
    const { POST } = await loadWebhook();
    const body = "not-json-at-all";
    const response = await POST(signedRequest(body, sign(body, SECRET)));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "LINE_WEBHOOK_MALFORMED_JSON",
    });
  });

  it("returns 413 before processing an oversized body", async () => {
    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [] });
    const request = new NextRequest("http://localhost:3000/api/line/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-line-signature": sign(body, SECRET),
        "content-length": String(129 * 1024),
      },
      body,
    });

    expect((await POST(request)).status).toBe(413);
    expect(webhookMocks.inboxCreate).not.toHaveBeenCalled();
  });

  it("does not log the userId into console output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { POST } = await loadWebhook();
    const body = JSON.stringify({ destination: "U0", events: [event("follow", "evt-log")] });
    await POST(signedRequest(body, sign(body, SECRET)));

    const allOutput = [...logSpy.mock.calls, ...infoSpy.mock.calls]
      .flat()
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join("\n");

    expect(allOutput).not.toContain(VALID_UID);
    logSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
