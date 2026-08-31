import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const findReservationsCompatMock = vi.hoisted(() => vi.fn());
const claimAndSendLineReminderMock = vi.hoisted(() => vi.fn());
const hasLineMessagingEnvMock = vi.hoisted(() => vi.fn(() => true));
const schedulerHeartbeatMocks = vi.hoisted(() => ({
  markSchedulerStarted: vi.fn(),
  markSchedulerSucceeded: vi.fn(),
  markSchedulerFailed: vi.fn(),
  readSchedulerContext: vi.fn(() => ({ schedulerKind: "GITHUB_ACTIONS", runId: "test-run" })),
}));
const today = new Date("2026-08-15T03:00:00.000Z");
const targetDate = "2026-08-16";
const lineUserId = `U${"0".repeat(32)}`;

vi.mock("@/lib/env", () => ({
  env: {
    CRON_SECRET: "cron-secret",
    LINE_MONTHLY_REMINDER_LIMIT: 1,
    LINE_MONTHLY_REMINDER_WARN_THRESHOLD: 1,
  },
  hasLineMessagingEnv: hasLineMessagingEnvMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    reservation: {
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

vi.mock("@/lib/reservation-compat", () => ({
  RESERVATION_SCHEMA_NOT_READY_CODE: "RESERVATION_SCHEMA_NOT_READY",
  ensureReservationSchemaReady: vi.fn().mockResolvedValue(undefined),
  findReservationsCompat: findReservationsCompatMock,
  isReservationSchemaNotReadyError: vi.fn(() => false),
}));

vi.mock("@/lib/dates", () => ({
  formatJst: vi.fn(() => targetDate),
  getJstDayOfMonth: vi.fn(() => 15),
  startOfJstMonth: vi.fn(() => new Date("2026-08-01T03:00:00.000Z")),
  todayJst: vi.fn(() => today),
}));

vi.mock("@/lib/line", () => ({
  getLineMonthlyQuotaConsumption: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/lib/line-notification", () => ({
  claimAndSendLineReminder: claimAndSendLineReminderMock,
}));

vi.mock("@/lib/scheduler-heartbeat", () => schedulerHeartbeatMocks);

vi.mock("@/lib/logger", () => ({
  getRequestId: vi.fn(() => "request-reminder-test"),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

function request(query = "") {
  return new NextRequest(`http://localhost:3000/api/crons/remind${query}`, {
    method: "GET",
    headers: { authorization: "Bearer cron-secret" },
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  findReservationsCompatMock.mockResolvedValue([
    {
      id: "reservation-1",
      createdAt: new Date("2026-08-15T03:00:00.000Z"),
      lineUserId,
    },
  ]);
  claimAndSendLineReminderMock.mockResolvedValue("sent");
  hasLineMessagingEnvMock.mockReturnValue(true);
  schedulerHeartbeatMocks.markSchedulerStarted.mockResolvedValue(undefined);
  schedulerHeartbeatMocks.markSchedulerSucceeded.mockResolvedValue(undefined);
  schedulerHeartbeatMocks.markSchedulerFailed.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetModules();
});

describe("LINE reminder cron hardening", () => {
  it("forwards a bounded batch/deadline and an atomic quota limit to the worker", async () => {
    const { GET } = await import("@/app/api/crons/remind/route");
    const response = await GET(request("?batchSize=1&deadlineMs=900&cursor=invalid"));

    expect(response.status).toBe(200);
    expect(findReservationsCompatMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        take: 1,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    );
    expect(claimAndSendLineReminderMock).toHaveBeenCalledWith(
      "reservation-1",
      lineUserId,
      targetDate,
      "CRON",
      { monthlyQuota: 1 }
    );
    await expect(response.json()).resolves.toMatchObject({
      sent: 1,
      skippedQuota: 0,
      deadlineReached: false,
    });
    expect(schedulerHeartbeatMocks.markSchedulerStarted).toHaveBeenCalledWith(
      "LINE_REMINDER",
      expect.objectContaining({ schedulerKind: "GITHUB_ACTIONS" }),
    );
    expect(schedulerHeartbeatMocks.markSchedulerSucceeded).toHaveBeenCalledWith(
      "LINE_REMINDER",
      expect.anything(),
      expect.objectContaining({ processed: 1, retry: 0 }),
    );
  });

  it("counts quota outcomes separately from ordinary skips", async () => {
    claimAndSendLineReminderMock.mockResolvedValue("quota");
    const { GET } = await import("@/app/api/crons/remind/route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sent: 0,
      skipped: 0,
      skippedQuota: 1,
    });
  });

  it("returns the workflow success contract when LINE is intentionally disabled", async () => {
    hasLineMessagingEnvMock.mockReturnValue(false);
    const { GET } = await import("@/app/api/crons/remind/route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "SKIPPED_LINE_SETUP",
      sent: 0,
      failed: 0,
      skipped: 1,
      skippedQuota: 0,
      nextCursor: null,
    });
  });
});
