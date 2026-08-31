import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationStatus, ReservationType } from "@prisma/client";

const transactionMock = vi.hoisted(() => vi.fn());
const ensureReservationSchemaReadyMock = vi.hoisted(() => vi.fn());
const isReservationSchemaNotReadyErrorMock = vi.hoisted(() => vi.fn());
const getStaffAuthMock = vi.hoisted(() => vi.fn());
const acquireReservationAdvisoryLockMock = vi.hoisted(() => vi.fn());
const evaluateReservationAvailabilityMock = vi.hoisted(() => vi.fn());
const findUniqueMock = vi.hoisted(() => vi.fn());
const findManyMock = vi.hoisted(() => vi.fn());
const updateManyMock = vi.hoisted(() => vi.fn());
const businessDayFindUniqueMock = vi.hoisted(() => vi.fn());
const correctionAuditCreateMock = vi.hoisted(() => vi.fn());

const current = {
  id: "reservation-1",
  date: "2026-08-06",
  servicePeriod: "DINNER" as const,
  reservationType: ReservationType.NORMAL,
  seatType: "MAIN" as const,
  partySize: 2,
  arrivalTime: "18:00",
  name: "山田 太郎",
  phone: "090-1111-2222",
  note: "コース: ディナー: 席のみ",
  status: ReservationStatus.CONFIRMED,
  updatedAt: new Date("2026-08-04T00:00:00.000Z"),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/reservation-compat", () => ({
  RESERVATION_SCHEMA_NOT_READY_CODE: "RESERVATION_SCHEMA_NOT_READY",
  ensureReservationSchemaReady: ensureReservationSchemaReadyMock,
  isReservationSchemaNotReadyError: isReservationSchemaNotReadyErrorMock,
}));

vi.mock("@/lib/staff-auth", () => ({
  getStaffAuth: getStaffAuthMock,
}));

vi.mock("@/lib/reservation-advisory-lock", () => ({
  acquireReservationAdvisoryLock: acquireReservationAdvisoryLockMock,
}));

vi.mock("@/lib/reservation-capacity", () => ({
  evaluateReservationAvailability: evaluateReservationAvailabilityMock,
}));

const txClient = {
  reservation: {
    findUnique: findUniqueMock,
    findMany: findManyMock,
    updateMany: updateManyMock,
  },
  businessDay: {
    findUnique: businessDayFindUniqueMock,
  },
  reservationCorrectionAuditLog: {
    create: correctionAuditCreateMock,
  },
  $executeRaw: vi.fn(),
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  getStaffAuthMock.mockResolvedValue({
    userId: "staff-user-1",
    email: "staff@example.com",
    role: "ADMIN",
    aal: "aal2",
  });
  ensureReservationSchemaReadyMock.mockResolvedValue(undefined);
  isReservationSchemaNotReadyErrorMock.mockReturnValue(false);
  transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback(txClient),
  );
  findUniqueMock.mockImplementation(async () =>
    updateManyMock.mock.calls.length > 0
      ? { ...current, phone: "090-9999-8888" }
      : current,
  );
  findManyMock.mockResolvedValue([]);
  updateManyMock.mockResolvedValue({ count: 1 });
  businessDayFindUniqueMock.mockResolvedValue(null);
  correctionAuditCreateMock.mockResolvedValue({ id: "correction-audit-1" });
  evaluateReservationAvailabilityMock.mockReturnValue({
    reason: "OK",
    webBookable: true,
  });
});

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/admin/reservations/reservation-1/correction", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

async function patch(body: Record<string, unknown>) {
  const { PATCH } = await import("@/app/api/admin/reservations/[id]/correction/route");
  return PATCH(buildRequest(body), {
    params: Promise.resolve({ id: "reservation-1" }),
  });
}

describe("admin reservation correction route", () => {
  it("allows contact-only correction without reapplying closure or capacity rules", async () => {
    const response = await patch({
      phone: "090-9999-8888",
      reason: "電話番号の聞き間違いを訂正",
      expectedUpdatedAt: current.updatedAt.toISOString(),
    });

    expect(response.status).toBe(200);
    expect(businessDayFindUniqueMock).not.toHaveBeenCalled();
    expect(evaluateReservationAvailabilityMock).not.toHaveBeenCalled();
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: current.id, updatedAt: current.updatedAt },
      data: { phone: "090-9999-8888" },
    });
    expect(correctionAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reservationId: current.id,
        reason: "電話番号の聞き間違いを訂正",
        beforeData: { phone: current.phone },
        afterData: { phone: "090-9999-8888" },
        actorUserId: "staff-user-1",
        actorRole: "ADMIN",
      }),
    });
  });

  it("rejects a slot correction into a closed business day before writing", async () => {
    businessDayFindUniqueMock.mockResolvedValue({ isClosed: true });
    evaluateReservationAvailabilityMock.mockReturnValue({
      reason: "CLOSED",
      webBookable: false,
    });

    const response = await patch({
      date: "2026-08-07",
      reason: "日付訂正",
      expectedUpdatedAt: current.updatedAt.toISOString(),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "CORRECTION_AVAILABILITY_CLOSED",
    });
    expect(acquireReservationAdvisoryLockMock).toHaveBeenCalledTimes(2);
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(correctionAuditCreateMock).not.toHaveBeenCalled();
  });
});
