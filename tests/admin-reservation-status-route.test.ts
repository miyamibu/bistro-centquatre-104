import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReservationStatus, ReservationType } from "@prisma/client";

const transactionMock = vi.hoisted(() => vi.fn());
const ensureReservationSchemaReadyMock = vi.hoisted(() => vi.fn());
const findReservationByIdCompatMock = vi.hoisted(() => vi.fn());
const updateReservationStatusCompatMock = vi.hoisted(() => vi.fn());

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

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    ADMIN_BASIC_USER: "admin",
    ADMIN_BASIC_PASS: "pass",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    RATE_LIMIT_HASH_SECRET: "test-rate-limit-hash-secret-32chars",
  };
  ensureReservationSchemaReadyMock.mockResolvedValue(undefined);
  transactionMock.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({}));
  findReservationByIdCompatMock.mockReset();
  updateReservationStatusCompatMock.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

function patchRequest(status: ReservationStatus) {
  const basicToken = Buffer.from("admin:pass").toString("base64");
  return new NextRequest("http://localhost:3000/api/admin/reservations/res-1", {
    method: "PATCH",
    headers: {
      authorization: `Basic ${basicToken}`,
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({ status }),
  });
}

function reservation(status: ReservationStatus) {
  return {
    id: "res-1",
    date: "2099-12-30",
    servicePeriod: "DINNER",
    reservationType: ReservationType.NORMAL,
    status,
  };
}

async function patch(status: ReservationStatus) {
  const { PATCH } = await import("@/app/api/admin/reservations/[id]/route");
  return PATCH(patchRequest(status), { params: Promise.resolve({ id: "res-1" }) });
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

    const response = await patch(ReservationStatus.DONE);

    expect(response.status).toBe(200);
    expect(updateReservationStatusCompatMock).toHaveBeenCalledWith(
      expect.anything(),
      "res-1",
      ReservationStatus.DONE
    );
  });
});
