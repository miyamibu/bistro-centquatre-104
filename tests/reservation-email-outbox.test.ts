import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  upsert: vi.fn(),
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
  sendCustomerReservationEmail: vi.fn(),
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
      status: "CONFIRMED",
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

  it("uses a fresh provider idempotency key for an explicit customer resend", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "outbox-1", status: "PENDING" });
    const tx = { reservationEmailOutbox: { upsert } };
    const { enqueueReservationCustomerEmail } = await import(
      "@/lib/reservation-email-outbox"
    );

    await enqueueReservationCustomerEmail(tx as never, "reservation-1", { reset: true });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: "PENDING",
          providerIdempotencyKey: expect.stringMatching(
            /^reservation-email-outbox\/resend\/[0-9a-f-]{36}$/,
          ),
        }),
      }),
    );
  });

  it("suppresses a pending confirmation when a reservation is cancelled", async () => {
    const { suppressReservationConfirmationEmail } = await import(
      "@/lib/reservation-email-outbox"
    );
    const tx = { reservationEmailOutbox: { updateMany: mocks.updateMany } };

    await suppressReservationConfirmationEmail(tx as never, "reservation-1");

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        reservationId: "reservation-1",
        notificationType: {
          in: ["RESERVATION_CONFIRMATION", "CUSTOMER_CONFIRMATION"],
        },
        status: "PENDING",
      },
      data: {
        status: "DEAD_LETTER",
        nextAttemptAt: null,
        lockedUntil: null,
        claimToken: null,
        lastError: "RESERVATION_CANCELLED",
      },
    });
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
      deadlineReached: false,
      nextCursor: null,
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
    expect(mocks.sendReservationEmail).toHaveBeenCalledWith({
      reservation: expect.objectContaining({ id: "reservation-1" }),
      adminUrl: "https://example.test/admin/reservations/reservation-1",
      idempotencyKey: "reservation-email-outbox/outbox-1",
    });
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

  it("persists the provider message ID when marking SENT fails after provider acceptance", async () => {
    mocks.sendReservationEmail.mockResolvedValue({
      sent: true,
      provider: "resend",
      providerMessageId: "mail-accepted-1",
    });
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error("database write failed"))
      .mockResolvedValueOnce({ count: 1 });

    const { processReservationEmailOutbox } = await import(
      "@/lib/reservation-email-outbox"
    );
    const summary = await processReservationEmailOutbox({ requestId: "request-post-send" });

    expect(summary).toMatchObject({
      sent: 0,
      failed: 1,
      unsafe: 0,
    });
    expect(mocks.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          providerMessageId: "mail-accepted-1",
          providerIdempotencyKey: "reservation-email-outbox/outbox-1",
        }),
      })
    );
  });

  it("does not let a stale worker overwrite a newer fenced claim", async () => {
    mocks.sendReservationEmail.mockResolvedValue({
      sent: true,
      provider: "resend",
      providerMessageId: "mail-stale-1",
    });
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });

    const { processReservationEmailOutbox } = await import(
      "@/lib/reservation-email-outbox"
    );
    const summary = await processReservationEmailOutbox({ requestId: "request-stale" });

    expect(summary).toMatchObject({
      sent: 0,
      failed: 0,
      unsafe: 1,
    });
    expect(mocks.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          claimToken: expect.any(String),
          status: "PROCESSING",
        }),
      })
    );
  });

  it("marks a cancelled reservation SKIPPED immediately before provider send", async () => {
    mocks.findFirst.mockResolvedValueOnce(
      claimedRow({
        reservation: {
          id: "reservation-1",
          reservationType: "NORMAL",
          status: "CANCELLED",
        },
      })
    );
    const { processReservationEmailOutbox } = await import(
      "@/lib/reservation-email-outbox"
    );
    const summary = await processReservationEmailOutbox({ requestId: "request-cancel-race" });
    expect(summary).toMatchObject({
      sent: 0,
      failed: 0,
      skipped: 1,
      unsafe: 0,
    });
    expect(mocks.sendReservationEmail).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED",
          lastError: "SKIPPED_RESERVATION_STATUS_CANCELLED",
        }),
      })
    );
  });

  it("uses the same idempotency key on a replay of the same outbox row", async () => {
    mocks.sendReservationEmail.mockResolvedValue({ sent: true, provider: "resend" });
    const { processReservationEmailOutbox } = await import(
      "@/lib/reservation-email-outbox"
    );

    await processReservationEmailOutbox({ requestId: "request-replay-1" });
    await processReservationEmailOutbox({ requestId: "request-replay-2" });

    expect(mocks.sendReservationEmail).toHaveBeenCalledTimes(2);
    expect(mocks.sendReservationEmail.mock.calls[0][0].idempotencyKey).toBe(
      "reservation-email-outbox/outbox-1"
    );
    expect(mocks.sendReservationEmail.mock.calls[1][0].idempotencyKey).toBe(
      "reservation-email-outbox/outbox-1"
    );
  });

  it("uses the persisted resend idempotency key instead of regenerating it", async () => {
    const resendKey = "reservation-email-outbox/resend/test-generation";
    mocks.findFirst.mockResolvedValue(
      claimedRow({ providerIdempotencyKey: resendKey }),
    );
    mocks.sendReservationEmail.mockResolvedValue({ sent: true, provider: "resend" });
    const { processReservationEmailOutbox } = await import(
      "@/lib/reservation-email-outbox"
    );

    await processReservationEmailOutbox({ requestId: "request-resend" });

    expect(mocks.sendReservationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: resendKey }),
    );
  });

  it("stops at the deadline and returns a cursor for the next batch", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "outbox-1", createdAt: new Date("2026-07-28T09:00:00.000Z") },
      { id: "outbox-2", createdAt: new Date("2026-07-28T09:00:01.000Z") },
    ]);
    mocks.sendReservationEmail.mockImplementation(async () => {
      vi.advanceTimersByTime(300);
      return { sent: true, provider: "resend" };
    });

    const { processReservationEmailOutbox } = await import(
      "@/lib/reservation-email-outbox"
    );
    const summary = await processReservationEmailOutbox({
      requestId: "request-deadline",
      batchSize: 2,
      deadlineMs: 250,
    });

    expect(summary).toMatchObject({
      scanned: 2,
      sent: 1,
      deadlineReached: true,
    });
    expect(summary.nextCursor).toEqual(expect.any(String));
    expect(mocks.sendReservationEmail).toHaveBeenCalledTimes(1);
  });
});
