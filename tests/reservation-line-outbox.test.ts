import { beforeEach, describe, expect, it, vi } from "vitest";

const pushLineTextMessageMock = vi.hoisted(() => vi.fn());
const notificationEventUpdateManyMock = vi.hoisted(() => vi.fn());
const notificationEventFindFirstMock = vi.hoisted(() => vi.fn());
const lineFriendFindUniqueMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationEvent: {
      updateMany: notificationEventUpdateManyMock,
      findFirst: notificationEventFindFirstMock,
      findMany: vi.fn(),
    },
    lineFriend: { findUnique: lineFriendFindUniqueMock },
  },
}));

vi.mock("@/lib/line", () => ({
  pushLineTextMessage: pushLineTextMessageMock,
  summarizeLineError: vi.fn((error: unknown) => String(error)),
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

const lineUserId = `U${"0".repeat(32)}`;

beforeEach(() => {
  vi.clearAllMocks();
  notificationEventUpdateManyMock.mockResolvedValue({ count: 1 });
  lineFriendFindUniqueMock.mockResolvedValue({ friendshipStatus: "ACTIVE" });
  pushLineTextMessageMock.mockResolvedValue({ ok: true });
});

describe("reservation LINE lifecycle outbox", () => {
  it("uses a unique ledger upsert and does not enqueue an unlinked reservation", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "line-event-1" });
    const tx = { notificationEvent: { upsert } };
    const { enqueueReservationLineLifecycle } = await import("@/lib/reservation-line-outbox");

    await expect(enqueueReservationLineLifecycle(tx as never, {
      reservationId: "reservation-1",
      lineUserId: null,
      type: "RESERVATION_CHANGED",
      eventKey: "revision-1",
    })).resolves.toBeNull();
    expect(upsert).not.toHaveBeenCalled();

    await enqueueReservationLineLifecycle(tx as never, {
      reservationId: "reservation-1",
      lineUserId,
      type: "RESERVATION_CHANGED",
      eventKey: "revision-1",
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        reservationId_channel_type_targetDate: {
          reservationId: "reservation-1",
          channel: "LINE",
          type: "RESERVATION_CHANGED",
          targetDate: "revision-1",
        },
      },
      update: {},
    }));
  });

  it("sends a cancellation only to the currently linked reservation owner", async () => {
    notificationEventFindFirstMock.mockResolvedValue({
      id: "line-event-1",
      type: "RESERVATION_CANCELLED",
      retryKey: "00000000-0000-0000-0000-000000000001",
      reservation: {
        id: "reservation-1",
        reservationType: "NORMAL",
        status: "CANCELLED",
        lineUserId,
        name: "E2E owner",
        date: "2026-09-10",
        servicePeriod: "DINNER",
        partySize: 2,
        arrivalTime: "18:00",
      },
    });
    const { processReservationLineLifecycleEvent } = await import(
      "@/lib/reservation-line-outbox"
    );

    await expect(
      processReservationLineLifecycleEvent("line-event-1", "TEST"),
    ).resolves.toBe("sent");
    expect(pushLineTextMessageMock).toHaveBeenCalledWith({
      to: lineUserId,
      text: expect.stringContaining("ご予約をキャンセルしました。"),
      retryKey: "00000000-0000-0000-0000-000000000001",
    });
    expect(notificationEventUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }),
    );
  });

  it("skips a stale change event after the reservation was cancelled", async () => {
    notificationEventFindFirstMock.mockResolvedValue({
      id: "line-event-1",
      type: "RESERVATION_CHANGED",
      retryKey: "00000000-0000-0000-0000-000000000001",
      reservation: {
        id: "reservation-1",
        reservationType: "NORMAL",
        status: "CANCELLED",
        lineUserId,
      },
    });
    const { processReservationLineLifecycleEvent } = await import(
      "@/lib/reservation-line-outbox"
    );

    await expect(
      processReservationLineLifecycleEvent("line-event-1", "TEST"),
    ).resolves.toBe("skipped");
    expect(pushLineTextMessageMock).not.toHaveBeenCalled();
    expect(notificationEventUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SKIPPED" }) }),
    );
  });
});
