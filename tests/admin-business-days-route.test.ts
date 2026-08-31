import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transactionMock = vi.hoisted(() => vi.fn());
const getStaffAuthMock = vi.hoisted(() => vi.fn());
const ensureReservationSchemaReadyMock = vi.hoisted(() => vi.fn());
const findReservationsCompatMock = vi.hoisted(() => vi.fn());
const acquireReservationAdvisoryLockMock = vi.hoisted(() => vi.fn());
const businessDayFindUniqueMock = vi.hoisted(() => vi.fn());
const businessDayUpsertMock = vi.hoisted(() => vi.fn());
const businessDayAuditCreateMock = vi.hoisted(() => vi.fn());

const txClient = {
  businessDay: {
    findUnique: businessDayFindUniqueMock,
    upsert: businessDayUpsertMock,
  },
  businessDayAuditLog: {
    create: businessDayAuditCreateMock,
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/staff-auth", () => ({
  getStaffAuth: getStaffAuthMock,
}));

vi.mock("@/lib/reservation-compat", () => ({
  RESERVATION_SCHEMA_NOT_READY_CODE: "RESERVATION_SCHEMA_NOT_READY",
  ensureReservationSchemaReady: ensureReservationSchemaReadyMock,
  findReservationsCompat: findReservationsCompatMock,
  isReservationSchemaNotReadyError: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/reservation-advisory-lock", () => ({
  acquireReservationAdvisoryLock: acquireReservationAdvisoryLockMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  getStaffAuthMock.mockResolvedValue({
    userId: "staff-user-1",
    email: "staff@example.com",
    role: "ADMIN",
  });
  ensureReservationSchemaReadyMock.mockResolvedValue(undefined);
  findReservationsCompatMock.mockResolvedValue([]);
  transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback(txClient),
  );
  businessDayFindUniqueMock.mockResolvedValue(null);
  businessDayUpsertMock.mockResolvedValue({
    id: "business-day-1",
    date: "2026-08-07",
    isClosed: true,
    note: "設備点検",
  });
  businessDayAuditCreateMock.mockResolvedValue({ id: "business-day-audit-1" });
});

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/admin/business-days", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

async function post(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/admin/business-days/route");
  return POST(buildRequest(body));
}

describe("admin business day route", () => {
  it("blocks a default closure when confirmed reservations exist", async () => {
    findReservationsCompatMock.mockResolvedValue([
      { partySize: 2, reservationType: "NORMAL" },
      { partySize: 4, reservationType: "PRIVATE_BLOCK" },
    ]);

    const response = await post({
      date: "2026-08-07",
      isClosed: true,
      note: "設備点検",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "BUSINESS_DAY_CONFIRMED_RESERVATIONS",
      reservationCount: 2,
      partyTotal: 6,
      privateBlockCount: 1,
    });
    expect(businessDayUpsertMock).not.toHaveBeenCalled();
    expect(businessDayAuditCreateMock).not.toHaveBeenCalled();
  });

  it("requires and records a reason for a forced closure", async () => {
    findReservationsCompatMock.mockResolvedValue([
      { partySize: 2, reservationType: "NORMAL" },
    ]);

    const response = await post({
      date: "2026-08-07",
      isClosed: true,
      force: true,
      reason: "台風接近のため",
    });

    expect(response.status).toBe(200);
    expect(businessDayUpsertMock).toHaveBeenCalledWith({
      where: { date: "2026-08-07" },
      update: { isClosed: true, note: null },
      create: { date: "2026-08-07", isClosed: true, note: null },
    });
    expect(businessDayAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessDayId: "business-day-1",
        previousIsClosed: null,
        nextIsClosed: true,
        actorUserId: "staff-user-1",
        actorRole: "ADMIN",
        reason: "台風接近のため",
      }),
    });
  });
});
