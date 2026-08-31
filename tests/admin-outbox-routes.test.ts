import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStaffAuth: vi.fn(),
  reservationBacklog: vi.fn(),
  orderBacklog: vi.fn(),
  reservationProcess: vi.fn(),
  orderProcess: vi.fn(),
  heartbeatList: vi.fn(),
  auditCreate: vi.fn(),
  auditUpdate: vi.fn(),
}));

vi.mock("@/lib/staff-auth", () => ({ getStaffAuth: mocks.getStaffAuth }));
vi.mock("@/lib/reservation-email-outbox", () => ({
  getReservationEmailOutboxBacklog: mocks.reservationBacklog,
  processReservationEmailOutbox: mocks.reservationProcess,
}));
vi.mock("@/lib/order-notification-outbox", () => ({
  getOrderNotificationOutboxBacklog: mocks.orderBacklog,
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
    aal: "aal2",
  });
  mocks.reservationBacklog.mockResolvedValue({ backlog: 4, oldestBacklogAt: new Date("2026-08-26T00:00:00Z") });
  mocks.orderBacklog.mockResolvedValue({ backlog: 2, oldestBacklogAt: null });
  mocks.reservationProcess.mockResolvedValue({ scanned: 2, sent: 2, failed: 0, deadLetter: 0 });
  mocks.orderProcess.mockResolvedValue({ scanned: 1, sent: 1, failed: 0, deadLetter: 0 });
  mocks.heartbeatList.mockResolvedValue([]);
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.auditUpdate.mockResolvedValue({ id: "audit-1" });
});

describe("admin outbox operations", () => {
  it("requires an ADMIN AAL2 session", async () => {
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
    });
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
