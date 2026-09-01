import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationStatus, ReservationType } from "@prisma/client";

const transactionMock = vi.hoisted(() => vi.fn());
const auditLogCreateMock = vi.hoisted(() => vi.fn());
const privateBlockAuditLogMock = vi.hoisted(() => vi.fn());
const ensureReservationSchemaReadyMock = vi.hoisted(() => vi.fn());
const findReservationByIdCompatMock = vi.hoisted(() => vi.fn());
const updateReservationStatusCompatMock = vi.hoisted(() => vi.fn());
const getStaffAuthMock = vi.hoisted(() => vi.fn());
const enqueueReservationLineLifecycleMock = vi.hoisted(() => vi.fn());
const txClient = {
  reservationStatusAuditLog: {
    create: auditLogCreateMock,
  },
  reservationEmailOutbox: {
    updateMany: vi.fn(),
    upsert: vi.fn().mockResolvedValue({ id: "status-email-1", status: "PENDING" }),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/reservation-compat", () => ({
  RESERVATION_SCHEMA_NOT_READY_CODE: "RESERVATION_SCHEMA_NOT_READY",
  ensureReservationSchemaReady: ensureReservationSchemaReadyMock,
  findReservationByIdCompat: findReservationByIdCompatMock,
  isReservationSchemaNotReadyError: vi.fn().mockReturnValue(false),
  updateReservationStatusCompat: updateReservationStatusCompatMock,
}));

vi.mock("@/lib/private-block-audit", () => ({
  createPrivateBlockAuditLog: privateBlockAuditLogMock,
}));

vi.mock("@/lib/staff-auth", () => ({
  getStaffAuth: getStaffAuthMock,
}));

vi.mock("@/lib/after-response", () => ({ scheduleAfterResponse: vi.fn() }));
vi.mock("@/lib/reservation-line-outbox", () => ({
  enqueueReservationLineLifecycle: enqueueReservationLineLifecycleMock,
  processReservationLineLifecycleEvent: vi.fn(),
}));

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    RATE_LIMIT_HASH_SECRET: "test-rate-limit-hash-secret-32chars",
  };
  getStaffAuthMock.mockResolvedValue({
    userId: "staff-user-1",
    email: "staff@example.com",
    role: "ADMIN",
  });
  enqueueReservationLineLifecycleMock.mockResolvedValue({ id: "line-event-1" });
  ensureReservationSchemaReadyMock.mockResolvedValue(undefined);
  transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(txClient));
  findReservationByIdCompatMock.mockReset();
  updateReservationStatusCompatMock.mockReset();
  auditLogCreateMock.mockReset();
  privateBlockAuditLogMock.mockReset();
  getStaffAuthMock.mockResolvedValue({
    userId: "staff-user-1",
    email: "staff@example.com",
    role: "ADMIN",
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

function patchRequest(status: ReservationStatus, body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost:3000/api/admin/reservations/res-1", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ status, ...body }),
  });
}

function reservationBase(status: ReservationStatus): {
  id: string;
  date: string;
  servicePeriod: "DINNER";
  reservationType: ReservationType;
  status: ReservationStatus;
  lineUserId: string;
  updatedAt: Date;
} {
  return {
    id: "res-1",
    date: "2099-12-30",
    servicePeriod: "DINNER",
    reservationType: ReservationType.NORMAL,
    status,
    lineUserId: `U${"0".repeat(32)}`,
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
}

function reservation(
  status: ReservationStatus,
  overrides: Partial<ReturnType<typeof reservationBase>> = {}
) {
  return { ...reservationBase(status), ...overrides };
}

async function patch(status: ReservationStatus, body: Record<string, unknown> = {}) {
  const { PATCH } = await import("@/app/api/admin/reservations/[id]/route");
  return PATCH(patchRequest(status, body), { params: Promise.resolve({ id: "res-1" }) });
}

describe("admin reservation status transitions", () => {
  it("treats same-state updates as idempotent no-ops", async () => {
    findReservationByIdCompatMock.mockResolvedValue(reservation(ReservationStatus.CANCELLED));

    const response = await patch(ReservationStatus.CANCELLED);

    expect(response.status).toBe(200);
    expect(updateReservationStatusCompatMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      id: "res-1",
      status: ReservationStatus.CANCELLED,
    });
  });

  it("rejects restoring a terminal reservation to CONFIRMED", async () => {
    findReservationByIdCompatMock.mockResolvedValue(reservation(ReservationStatus.CANCELLED));

    const response = await patch(ReservationStatus.CONFIRMED);

    expect(response.status).toBe(409);
    expect(updateReservationStatusCompatMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "TERMINAL_STATUS_TRANSITION_NOT_ALLOWED",
    });
  });

  it("allows CONFIRMED to move to a terminal status", async () => {
    findReservationByIdCompatMock.mockResolvedValue(reservation(ReservationStatus.CONFIRMED));
    updateReservationStatusCompatMock.mockResolvedValue(reservation(ReservationStatus.DONE));

    const response = await patch(ReservationStatus.DONE, { reason: "来店確認" });

    expect(response.status).toBe(200);
    expect(updateReservationStatusCompatMock).toHaveBeenCalledWith(
      txClient,
      "res-1",
      ReservationStatus.CONFIRMED,
      ReservationStatus.DONE
    );
    expect(findReservationByIdCompatMock).toHaveBeenCalledWith(txClient, "res-1");
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reservationId: "res-1",
        previousStatus: ReservationStatus.CONFIRMED,
        nextStatus: ReservationStatus.DONE,
        reason: "来店確認",
      }),
    });
  });

  it("queues the same cancellation customer-notification contract as self-service", async () => {
    findReservationByIdCompatMock.mockResolvedValue(reservation(ReservationStatus.CONFIRMED));
    updateReservationStatusCompatMock.mockResolvedValue(reservation(ReservationStatus.CANCELLED));

    const response = await patch(ReservationStatus.CANCELLED, { reason: "お客様都合" });

    expect(response.status).toBe(200);
    expect(txClient.reservationEmailOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reservationId: "res-1",
          status: "PENDING",
        }),
      })
    );
    expect(txClient.reservationEmailOutbox.upsert).toHaveBeenCalledWith({
      where: {
        reservationId_notificationType: {
          reservationId: "res-1",
          notificationType: "RESERVATION_CANCELLED_CUSTOMER",
        },
      },
      create: expect.objectContaining({
        reservationId: "res-1",
        notificationType: "RESERVATION_CANCELLED_CUSTOMER",
        status: "PENDING",
      }),
      update: {},
      select: { id: true, status: true },
    });
  });

  it.each([ReservationStatus.DONE, ReservationStatus.NOSHOW])(
    "rejects %s for PRIVATE_BLOCK",
    async (nextStatus) => {
      findReservationByIdCompatMock.mockResolvedValue(
        reservation(ReservationStatus.CONFIRMED, {
          reservationType: ReservationType.PRIVATE_BLOCK,
        })
      );

      const response = await patch(nextStatus);

      expect(response.status).toBe(409);
      expect(updateReservationStatusCompatMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        code: "RESERVATION_STATUS_TRANSITION_NOT_ALLOWED",
      });
    }
  );

  it("rejects a private-block release when the expected target is stale", async () => {
    findReservationByIdCompatMock.mockResolvedValue(
      reservation(ReservationStatus.CONFIRMED, {
        reservationType: ReservationType.PRIVATE_BLOCK,
      })
    );

    const response = await patch(ReservationStatus.CANCELLED, {
      operatorName: "担当者A",
      expectedDate: "2099-12-29",
      expectedServicePeriod: "DINNER",
      expectedReservationType: ReservationType.PRIVATE_BLOCK,
    });

    expect(response.status).toBe(409);
    expect(updateReservationStatusCompatMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "RESERVATION_TARGET_MISMATCH",
    });
  });

  it("stores operator and reason in status and private-block audit logs", async () => {
    findReservationByIdCompatMock.mockResolvedValue(
      reservation(ReservationStatus.CONFIRMED, {
        reservationType: ReservationType.PRIVATE_BLOCK,
      })
    );
    updateReservationStatusCompatMock.mockResolvedValue(
      reservation(ReservationStatus.CANCELLED, {
        reservationType: ReservationType.PRIVATE_BLOCK,
      })
    );

    const response = await patch(ReservationStatus.CANCELLED, {
      operatorName: "担当者A",
      reason: "貸切解除の依頼",
      expectedDate: "2099-12-30",
      expectedServicePeriod: "DINNER",
      expectedReservationType: ReservationType.PRIVATE_BLOCK,
    });

    expect(response.status).toBe(200);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorName: "staff@example.com",
        actorUserId: "staff-user-1",
        actorEmail: "staff@example.com",
        actorRole: "ADMIN",
        operatorLabel: "担当者A",
        reason: "貸切解除の依頼",
      }),
    });
    expect(privateBlockAuditLogMock).toHaveBeenCalledWith(
      txClient,
      expect.objectContaining({
        actorName: "staff@example.com",
        actorUserId: "staff-user-1",
        actorEmail: "staff@example.com",
        actorRole: "ADMIN",
        operatorLabel: "担当者A",
        note: "貸切解除の依頼",
      })
    );
  });

  it("returns a conflict when the compare-and-set update loses a race", async () => {
    findReservationByIdCompatMock.mockResolvedValue(reservation(ReservationStatus.CONFIRMED));
    updateReservationStatusCompatMock.mockResolvedValue(null);

    const response = await patch(ReservationStatus.DONE, { reason: "来店確認" });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "RESERVATION_STATUS_CONFLICT",
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
