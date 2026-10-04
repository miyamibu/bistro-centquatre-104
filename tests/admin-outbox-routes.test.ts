import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStaffAuth: vi.fn(),
  reservationBacklog: vi.fn(),
  reservationDeadLetters: vi.fn(),
  orderBacklog: vi.fn(),
  orderDeadLetters: vi.fn(),
  reservationProcess: vi.fn(),
  orderProcess: vi.fn(),
  heartbeatList: vi.fn(),
  auditCreate: vi.fn(),
  auditUpdate: vi.fn(),
}));

vi.mock("@/lib/staff-auth", () => ({ getStaffAuth: mocks.getStaffAuth }));
vi.mock("@/lib/reservation-email-outbox", () => ({
  getReservationEmailOutboxBacklog: mocks.reservationBacklog,
  getReservationEmailOutboxDeadLetters: mocks.reservationDeadLetters,
  processReservationEmailOutbox: mocks.reservationProcess,
}));
vi.mock("@/lib/order-notification-outbox", () => ({
  getOrderNotificationOutboxBacklog: mocks.orderBacklog,
  getOrderNotificationOutboxDeadLetters: mocks.orderDeadLetters,
  processOrderNotificationOutbox: mocks.orderProcess,
}));
vi.mock("@/lib/scheduler-heartbeat", () => ({
  listSchedulerHeartbeats: mocks.heartbeatList,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    outboxDrainAuditLog: {
      create: mocks.auditCreate,
      update: mocks.auditUpdate,
    },
  },
}));

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest("https://bistro.example/api/admin/outbox/drain", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      origin: "https://bistro.example",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function statusRequest(headers: Record<string, string> = {}) {
  return new NextRequest("https://bistro.example/api/admin/outbox/status", {
    method: "GET",
    headers: {
      "x-requested-with": "XMLHttpRequest",
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStaffAuth.mockResolvedValue({
    userId: "admin-1",
    email: "admin@example.com",
    role: "ADMIN",
  });
  mocks.reservationBacklog.mockResolvedValue({ backlog: 4, oldestBacklogAt: new Date("2026-08-26T00:00:00Z") });
  mocks.reservationDeadLetters.mockResolvedValue({ count: 3, oldestAt: new Date("2026-08-20T00:00:00Z") });
  mocks.orderBacklog.mockResolvedValue({ backlog: 2, oldestBacklogAt: null });
  mocks.orderDeadLetters.mockResolvedValue({ count: 1, oldestAt: new Date("2026-08-21T00:00:00Z") });
  mocks.reservationProcess.mockResolvedValue({ scanned: 2, sent: 2, failed: 0, deadLetter: 0 });
  mocks.orderProcess.mockResolvedValue({ scanned: 1, sent: 1, failed: 0, deadLetter: 0 });
  mocks.heartbeatList.mockResolvedValue([]);
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.auditUpdate.mockResolvedValue({ id: "audit-1" });
});

describe("admin outbox operations", () => {
  it("requires an ADMIN session", async () => {
    mocks.getStaffAuth.mockResolvedValue(null);
    const { POST } = await import("@/app/api/admin/outbox/drain/route");
    const response = await POST(request({ lane: "RESERVATION_EMAIL", limit: 2, dryRun: true, confirm: false }));

    expect(response.status).toBe(401);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("rejects cross-site writes before creating an audit row", async () => {
    const { POST } = await import("@/app/api/admin/outbox/drain/route");
    const response = await POST(request(
      { lane: "RESERVATION_EMAIL", limit: 2, dryRun: true, confirm: false },
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    ));

    expect(response.status).toBe(403);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("dry-runs without claiming or sending and records the request", async () => {
    const { POST } = await import("@/app/api/admin/outbox/drain/route");
    const response = await POST(request({ lane: "RESERVATION_EMAIL", limit: 2, dryRun: true, confirm: false }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ dryRun: true, backlog: 4, scanned: 0, sent: 0 });
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorUserId: "admin-1", dryRun: true, requestedLimit: 2 }),
    }));
    expect(mocks.reservationProcess).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation for a real drain", async () => {
    const { POST } = await import("@/app/api/admin/outbox/drain/route");
    const response = await POST(request({ lane: "ORDER_NOTIFICATION", limit: 1, dryRun: false, confirm: false }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(mocks.orderProcess).not.toHaveBeenCalled();
  });

  it("executes a bounded confirmed drain and finalizes its audit row", async () => {
    mocks.orderBacklog
      .mockResolvedValueOnce({ backlog: 2, oldestBacklogAt: null })
      .mockResolvedValueOnce({ backlog: 1, oldestBacklogAt: null });
    const { POST } = await import("@/app/api/admin/outbox/drain/route");
    const response = await POST(request({ lane: "ORDER_NOTIFICATION", limit: 1, dryRun: false, confirm: true }));

    expect(response.status).toBe(200);
    expect(mocks.orderProcess).toHaveBeenCalledWith({ requestId: expect.any(String), limit: 1, deadlineMs: 8_000 });
    expect(mocks.auditUpdate).toHaveBeenCalledWith({
      where: { id: "audit-1" },
      data: { scannedCount: 1, sentCount: 1, failedCount: 0, deadLetterCount: 0, backlogCount: 1 },
    });
  });

  it("reports stale GitHub scheduler lanes after 15 minutes", async () => {
    mocks.heartbeatList.mockResolvedValue([
      {
        schedulerKind: "GITHUB_ACTIONS",
        lane: "RESERVATION_EMAIL",
        lastStartedAt: new Date(),
        lastSuccessAt: new Date(Date.now() - 16 * 60 * 1000),
        lastFailureAt: null,
        processedCount: 0,
        retryCount: 0,
        deadLetterCount: 0,
        backlogCount: 0,
        oldestBacklogAt: null,
        lastRunId: "run-1",
        lastProviderCronAt: null,
        immediateAttempts: 0,
        immediateSuccesses: 0,
        lastErrorCode: null,
      },
    ]);
    const { GET } = await import("@/app/api/admin/outbox/status/route");
    const response = await GET(statusRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      warning: true,
      staleLanes: ["RESERVATION_EMAIL", "ORDER_NOTIFICATION"],
      scheduler: {
        ORDER_NOTIFICATION: { lastHeartbeatAt: null, lastSuccessAt: null },
      },
    });
  });

  it("marks both lanes stale when no scheduler heartbeat has been recorded", async () => {
    const { GET } = await import("@/app/api/admin/outbox/status/route");
    const response = await GET(statusRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      warning: true,
      staleLanes: ["RESERVATION_EMAIL", "ORDER_NOTIFICATION"],
      scheduler: {
        RESERVATION_EMAIL: { lastHeartbeatAt: null, lastSuccessAt: null },
        ORDER_NOTIFICATION: { lastHeartbeatAt: null, lastSuccessAt: null },
      },
    });
  });

  it("keeps a prior dead-letter total visible after a later successful heartbeat", async () => {
    mocks.reservationBacklog.mockResolvedValue({ backlog: 0, oldestBacklogAt: null });
    mocks.orderBacklog.mockResolvedValue({ backlog: 0, oldestBacklogAt: null });
    mocks.heartbeatList.mockResolvedValue([{
      schedulerKind: "GITHUB_ACTIONS",
      lane: "RESERVATION_EMAIL",
      lastStartedAt: new Date("2026-10-04T10:00:00Z"),
      lastSuccessAt: new Date("2026-10-04T10:00:01Z"),
      lastFailureAt: new Date("2026-10-04T09:45:00Z"),
      processedCount: 0,
      retryCount: 0,
      deadLetterCount: 0,
      backlogCount: 0,
      oldestBacklogAt: null,
      lastRunId: "run-230",
      lastProviderCronAt: null,
      immediateAttempts: 0,
      immediateSuccesses: 0,
      lastErrorCode: null,
    }]);
    const { GET } = await import("@/app/api/admin/outbox/status/route");
    const response = await GET(statusRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).toMatchObject({
      backlog: { reservation: { count: 0 }, order: { count: 0 } },
      deadLetters: { reservation: { count: 3 }, order: { count: 1 } },
      scheduler: {
        RESERVATION_EMAIL: {
          lastHeartbeatAt: "2026-10-04T10:00:00.000Z",
          lastSuccessAt: "2026-10-04T10:00:01.000Z",
          lastFailureAt: "2026-10-04T09:45:00.000Z",
        },
      },
      heartbeats: [{ deadLetterCount: 0, lastRunId: "run-230" }],
    });
    expect(JSON.stringify(body)).not.toMatch(/admin@example.com|providerMessageId|provider_message_id|"lastError":|delivered|deliveryConfirmed/);
  });

  it("rejects a cross-site status read before loading operational data", async () => {
    const { GET } = await import("@/app/api/admin/outbox/status/route");
    const response = await GET(statusRequest({
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }));

    expect(response.status).toBe(403);
    expect(mocks.heartbeatList).not.toHaveBeenCalled();
    expect(mocks.reservationBacklog).not.toHaveBeenCalled();
    expect(mocks.orderBacklog).not.toHaveBeenCalled();
    expect(mocks.reservationDeadLetters).not.toHaveBeenCalled();
    expect(mocks.orderDeadLetters).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated status read before querying aggregates", async () => {
    mocks.getStaffAuth.mockResolvedValue(null);
    const { GET } = await import("@/app/api/admin/outbox/status/route");
    const response = await GET(statusRequest());

    expect(response.status).toBe(401);
    expect(mocks.reservationDeadLetters).not.toHaveBeenCalled();
    expect(mocks.orderDeadLetters).not.toHaveBeenCalled();
    expect(mocks.heartbeatList).not.toHaveBeenCalled();
  });

  it("does not return a normal status when a dead-letter aggregate fails", async () => {
    mocks.reservationDeadLetters.mockRejectedValue(new Error("synthetic aggregate failure"));
    const { GET } = await import("@/app/api/admin/outbox/status/route");

    await expect(GET(statusRequest())).rejects.toThrow("synthetic aggregate failure");
  });


  it("requires an XMLHttpRequest marker for an authenticated status read", async () => {
    const { GET } = await import("@/app/api/admin/outbox/status/route");
    const response = await GET(statusRequest({ "x-requested-with": "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "MISSING_REQUEST_HEADER",
    });
    expect(mocks.heartbeatList).not.toHaveBeenCalled();
  });
});
