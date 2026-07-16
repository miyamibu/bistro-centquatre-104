import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const processOrderNotificationOutboxMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  env: { CRON_SECRET: "cron-secret" },
}));

vi.mock("@/lib/order-notification-outbox", () => ({
  processOrderNotificationOutbox: processOrderNotificationOutboxMock,
}));

vi.mock("@/lib/logger", () => ({
  getRequestId: vi.fn(() => "req-cron-test"),
  logError: vi.fn(),
}));

describe("process order notification cron route", () => {
  beforeEach(() => {
    processOrderNotificationOutboxMock.mockReset();
    processOrderNotificationOutboxMock.mockResolvedValue({
      scanned: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("rejects requests without the cron secret", async () => {
    const { GET } = await import("@/app/api/crons/process-order-notifications/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/crons/process-order-notifications")
    );

    expect(response.status).toBe(401);
    expect(processOrderNotificationOutboxMock).not.toHaveBeenCalled();
  });

  it("processes an authorized GET request", async () => {
    const { GET } = await import("@/app/api/crons/process-order-notifications/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/crons/process-order-notifications", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );

    expect(response.status).toBe(200);
    expect(processOrderNotificationOutboxMock).toHaveBeenCalledWith({
      requestId: "req-cron-test",
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scanned: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("supports authorized POST retries", async () => {
    const { POST } = await import("@/app/api/crons/process-order-notifications/route");
    const response = await POST(
      new NextRequest("http://localhost:3000/api/crons/process-order-notifications", {
        method: "POST",
        headers: { authorization: "Bearer cron-secret" },
      })
    );

    expect(response.status).toBe(200);
  });

  it("returns a retryable failure when delivery is partial", async () => {
    processOrderNotificationOutboxMock.mockResolvedValue({
      scanned: 2,
      sent: 1,
      failed: 1,
      skipped: 0,
    });
    const { GET } = await import("@/app/api/crons/process-order-notifications/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/crons/process-order-notifications", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "CRON_ORDER_NOTIFICATION_OUTBOX_PARTIAL_FAILURE",
      failed: 1,
    });
  });

  it("returns a retryable failure when outbox lookup fails", async () => {
    processOrderNotificationOutboxMock.mockResolvedValue({
      scanned: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      error: "LOOKUP_FAILED",
    });
    const { GET } = await import("@/app/api/crons/process-order-notifications/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/crons/process-order-notifications", {
        headers: { authorization: "Bearer cron-secret" },
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "CRON_ORDER_NOTIFICATION_OUTBOX_LOOKUP_FAILED",
      error: "Outbox lookup failed",
    });
  });
});
