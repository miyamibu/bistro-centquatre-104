import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const processReservationEmailOutboxMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  env: { CRON_SECRET: "cron-secret" },
}));

vi.mock("@/lib/reservation-email-outbox", () => ({
  processReservationEmailOutbox: processReservationEmailOutboxMock,
}));

vi.mock("@/lib/logger", () => ({
  getRequestId: vi.fn(() => "request-cron-test"),
  logError: vi.fn(),
}));

function request(method: "GET" | "POST", token?: string, query = "") {
  return new NextRequest(
    `http://localhost:3000/api/crons/process-reservation-emails${query}`,
    {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }
  );
}

beforeEach(() => {
  processReservationEmailOutboxMock.mockReset();
  processReservationEmailOutboxMock.mockResolvedValue({
    scanned: 0,
    sent: 0,
    failed: 0,
    deadLetter: 0,
    skipped: 0,
    unsafe: 0,
  });
});

describe("reservation email outbox cron route", () => {
  it("rejects requests without CRON_SECRET", async () => {
    const { GET } = await import(
      "@/app/api/crons/process-reservation-emails/route"
    );

    const response = await GET(request("GET"));

    expect(response.status).toBe(401);
    expect(processReservationEmailOutboxMock).not.toHaveBeenCalled();
  });

  it("processes authorized GET requests", async () => {
    const { GET } = await import(
      "@/app/api/crons/process-reservation-emails/route"
    );

    const response = await GET(request("GET", "cron-secret"));

    expect(response.status).toBe(200);
    expect(processReservationEmailOutboxMock).toHaveBeenCalledWith({
      requestId: "request-cron-test",
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scanned: 0,
      sent: 0,
      failed: 0,
      deadLetter: 0,
      unsafe: 0,
    });
  });

  it("supports authorized POST retries", async () => {
    const { POST } = await import(
      "@/app/api/crons/process-reservation-emails/route"
    );

    const response = await POST(request("POST", "cron-secret"));

    expect(response.status).toBe(200);
  });

  it("forwards bounded batch, deadline, and cursor query parameters", async () => {
    const { GET } = await import(
      "@/app/api/crons/process-reservation-emails/route"
    );

    const response = await GET(
      request(
        "GET",
        "cron-secret",
        "?batchSize=7&deadlineMs=900&cursor=cursor-token"
      )
    );

    expect(response.status).toBe(200);
    expect(processReservationEmailOutboxMock).toHaveBeenCalledWith({
      requestId: "request-cron-test",
      batchSize: 7,
      deadlineMs: 900,
      cursor: "cursor-token",
    });
  });

  it("returns 500 when retry or dead-letter work needs operator attention", async () => {
    processReservationEmailOutboxMock.mockResolvedValue({
      scanned: 2,
      sent: 1,
      failed: 1,
      deadLetter: 0,
      skipped: 0,
      unsafe: 0,
    });
    const { GET } = await import(
      "@/app/api/crons/process-reservation-emails/route"
    );

    const response = await GET(request("GET", "cron-secret"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "CRON_RESERVATION_EMAIL_OUTBOX_PARTIAL_FAILURE",
      failed: 1,
    });
  });

  it("returns 500 when the processor cannot read the outbox", async () => {
    processReservationEmailOutboxMock.mockRejectedValueOnce(
      new Error("database unavailable")
    );
    const { GET } = await import(
      "@/app/api/crons/process-reservation-emails/route"
    );

    const response = await GET(request("GET", "cron-secret"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "CRON_RESERVATION_EMAIL_OUTBOX_FAILED",
      error: "Cron execution failed",
    });
  });
});
