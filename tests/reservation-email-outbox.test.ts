import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  sendReservationEmail: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    reservationEmailOutbox: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendReservationEmail: mocks.sendReservationEmail,
}));

vi.mock("@/lib/env", () => ({
  env: {
    BASE_URL: "https://example.test",
  },
}));

vi.mock("@/lib/logger", () => ({
  logError: mocks.logError,
  logInfo: mocks.logInfo,
  logWarn: mocks.logWarn,
}));

const now = new Date("2026-07-28T09:00:00.000Z");

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    reservationId: "reservation-1",
    notificationType: "RESERVATION_CONFIRMATION",
    status: "PROCESSING",
    attempts: 1,
    maxAttempts: 5,
    reservation: {
      id: "reservation-1",
      reservationType: "NORMAL",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([{ id: "outbox-1" }]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findFirst.mockResolvedValue(claimedRow());
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("reservation confirmation email outbox", () => {
  it("enqueues idempotently by reservation and notification type without resetting state", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "outbox-1",
      status: "PENDING",
    });
    const tx = {
      reservationEmailOutbox: { upsert },
    };
    const { enqueueReservationConfirmationEmail } = await import(
      "@/lib/reservation-email-outbox"
    );

    await enqueueReservationConfirmationEmail(tx as never, "reservation-1");
    await enqueueReservationConfirmationEmail(tx as never, "reservation-1");

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(1, {
      where: {
        reservationId_notificationType: {
          reservationId: "reservation-1",
          notificationType: "RESERVATION_CONFIRMATION",
        },
      },
      create: {
        reservationId: "reservation-1",
        notificationType: "RESERVATION_CONFIRMATION",
        status: "PENDING",
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: now,
      },
      update: {},
      select: {
        id: true,
        status: true,
      },
    });
    expect(upsert.mock.calls[1]).toEqual(upsert.mock.calls[0]);
  });

  it("marks SENT only after the provider confirms delivery", async () => {
    mocks.sendReservationEmail.mockResolvedValue({
      sent: true,
      provider: "resend",
    });
    const { processReservationEmailOutbox } = await import(
      "@/lib/reservation-email-outbox"
    );

    const summary = await processReservationEmailOutbox({
      requestId: "request-1",
    });

    expect(summary).toEqual({
      scanned: 1,
      sent: 1,
      failed: 0,
      deadLetter: 0,
      skipped: 0,
      unsafe: 0,
    });
    expect(mocks.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PROCESSING",
          attempts: { increment: 1 },
          claimToken: expect.any(String),
        }),
      })
    );
    expect(mocks.sendReservationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SENT",
          sentAt: now,
          nextAttemptAt: null,
          lockedUntil: null,
          claimToken: null,
          lastError: null,
        }),
      })
    );
    expect(mocks.sendReservationEmail.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.updateMany.mock.invocationCallOrder[1]
    );
  });

  it("returns a failed delivery to PENDING with exponential backoff", async () => {
    mocks.sendReservationEmail.mockResolvedValue({
      skipped: true,
      reason: "MISSING_ENV",
    });
    const { processReservationEmailOutbox } = await import(
      "@/lib/reservation-email-outbox"
    );

    const summary = await processReservationEmailOutbox({
      requestId: "request-1",
    });

    expect(summary).toMatchObject({
      scanned: 1,
      sent: 0,
      failed: 1,
      deadLetter: 0,
      unsafe: 0,
    });
    expect(mocks.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          nextAttemptAt: new Date("2026-07-28T09:01:00.000Z"),
          lockedUntil: null,
          claimToken: null,
          lastError: "DELIVERY_MISSING_ENV",
        }),
      })
    );
  });

  it("moves the fifth failed attempt to DEAD_LETTER without another retry time", async () => {
    mocks.findFirst.mockResolvedValue(
      claimedRow({
        attempts: 5,
        maxAttempts: 5,
      })
    );
    mocks.sendReservationEmail.mockResolvedValue({
      skipped: true,
      reason: "SEND_FAILED",
    });
    const { processReservationEmailOutbox } = await import(
      "@/lib/reservation-email-outbox"
    );

    const summary = await processReservationEmailOutbox({
      requestId: "request-1",
    });

    expect(summary).toMatchObject({
      scanned: 1,
      sent: 0,
      failed: 0,
      deadLetter: 1,
      unsafe: 0,
    });
    expect(mocks.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DEAD_LETTER",
          nextAttemptAt: null,
          lastError: "DELIVERY_SEND_FAILED",
        }),
      })
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      "reservation_email_outbox.dead_letter",
      expect.objectContaining({
        context: expect.not.objectContaining({
          name: expect.anything(),
          phone: expect.anything(),
        }),
      })
    );
  });

  it("skips a row when another worker wins the atomic claim", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const { processReservationEmailOutbox } = await import(
      "@/lib/reservation-email-outbox"
    );

    const summary = await processReservationEmailOutbox({
      requestId: "request-1",
    });

    expect(summary).toMatchObject({
      scanned: 1,
      sent: 0,
      failed: 0,
      deadLetter: 0,
      skipped: 1,
      unsafe: 0,
    });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.sendReservationEmail).not.toHaveBeenCalled();
  });
});
