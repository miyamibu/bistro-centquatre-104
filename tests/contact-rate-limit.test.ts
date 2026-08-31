import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const sendContactEmailMock = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());
const logInfoMock = vi.hoisted(() => vi.fn());
const getRequestIdMock = vi.hoisted(() => vi.fn(() => "contact-request"));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    rpc: rpcMock,
  },
}));

vi.mock("@/lib/email", () => ({
  sendContactEmail: sendContactEmailMock,
}));

vi.mock("@/lib/logger", () => ({
  getRequestId: getRequestIdMock,
  logError: logErrorMock,
  logInfo: logInfoMock,
}));

const body = {
  name: "山田 太郎",
  email: "customer@example.com",
  subject: "お問い合わせ",
  message: "営業時間を教えてください。",
};

function request() {
  return new NextRequest("http://localhost:3000/api/contact", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-requested-with": "XMLHttpRequest",
      "x-forwarded-for": "203.0.113.10",
    },
    body: JSON.stringify(body),
  });
}

async function post() {
  const { POST } = await import("@/app/api/contact/route");
  return POST(request());
}

beforeEach(() => {
  vi.resetModules();
  rpcMock.mockReset();
  sendContactEmailMock.mockReset();
  logErrorMock.mockReset();
  logInfoMock.mockReset();
  getRequestIdMock.mockReturnValue("contact-request");
  sendContactEmailMock.mockResolvedValue({ sent: true, accepted: true, provider: "resend" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("contact rate limit", () => {
  it("returns 429 for concurrent requests rejected by the shared bucket", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });

    const responses = await Promise.all([post(), post()]);

    expect(responses.map((response) => response.status)).toEqual([429, 429]);
    expect(sendContactEmailMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[0]?.[0]).toBe("consume_contact_rate_limit");
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({
      p_window_seconds: 600,
      p_ip_max_requests: 5,
      p_email_max_requests: 3,
    });
  });

  it("fails closed when the shared rate-limit store is unavailable", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "rpc unavailable" } });

    const response = await post();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONTACT_RATE_LIMIT_UNAVAILABLE",
    });
    expect(sendContactEmailMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledWith(
      "contact.rate_limit.failed",
      expect.objectContaining({ errorCode: "CONTACT_RATE_LIMIT_UNAVAILABLE" }),
    );
  });

  it("sends only after the shared store grants the request", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });

    const response = await post();

    expect(response.status).toBe(200);
    expect(sendContactEmailMock).toHaveBeenCalledWith(body);
  });
});
