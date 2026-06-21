import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatJst } from "@/lib/dates";
import { getNextBookableReservationDate } from "@/lib/booking-rules";
import {
  createTestPrismaClient,
  safeTestDatabaseUrl,
  summarizeDatabaseUrl,
} from "./test-database";

const { sendReservationEmailMock } = vi.hoisted(() => ({
  sendReservationEmailMock: vi.fn().mockResolvedValue({ sent: true, provider: "resend" }),
}));

vi.mock("@/lib/email", () => ({
  sendReservationEmail: sendReservationEmailMock,
}));

const hasSafeDatabase = Boolean(safeTestDatabaseUrl);
const describeIfDatabase = hasSafeDatabase ? describe : describe.skip;
const prisma = hasSafeDatabase ? createTestPrismaClient() : null;

if (process.env.TEST_DATABASE_URL && !hasSafeDatabase) {
  console.warn(
    `[tests] Skipping destructive DB tests because TEST_DATABASE_URL is not a safe local test database: ${summarizeDatabaseUrl(process.env.TEST_DATABASE_URL)}`
  );
}

if (!process.env.TEST_DATABASE_URL) {
  console.warn("[tests] Skipping destructive DB tests because TEST_DATABASE_URL is not set");
}

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/reservations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify(body),
  });
}

function buildPayload(overrides: Partial<Record<string, unknown>> = {}) {
  const date = formatJst(getNextBookableReservationDate());

  return {
    date,
    servicePeriod: "DINNER",
    partySize: 2,
    arrivalTime: "18:00",
    name: "山田　花子",
    phone: "090-1234-5678",
    note: "テスト予約",
    course: "ディナー: 席のみ",
    ...overrides,
  };
}

async function clearReservationArtifacts() {
  if (!prisma) {
    throw new Error("Safe TEST_DATABASE_URL is required for destructive DB tests");
  }

  await prisma.$executeRawUnsafe('DELETE FROM "ReservationRateLimitEvent"');
  await prisma.$executeRawUnsafe('DELETE FROM "Reservation"');
}

describeIfDatabase("reservations route duplicate guard (db)", () => {
  beforeEach(async () => {
    vi.resetModules();
    sendReservationEmailMock.mockClear();
    await clearReservationArtifacts();
  });

  afterAll(async () => {
    await clearReservationArtifacts();
    await prisma!.$disconnect();
  });

  it("returns the existing reservation for duplicate submissions within 1 minute", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const payload = buildPayload();

    const firstResponse = await POST(buildRequest(payload));
    const firstBody = await firstResponse.json();

    const secondResponse = await POST(
      buildRequest({
        ...payload,
        name: " 山田 花子 ",
        phone: "09012345678",
      })
    );
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstBody.deduplicated).toBe(false);
    expect(secondResponse.status).toBe(200);
    expect(secondBody.deduplicated).toBe(true);
    expect(secondBody.reservationId).toBe(firstBody.reservationId);

    const reservations = await prisma!.reservation.findMany({
      where: {
        date: payload.date as string,
        servicePeriod: payload.servicePeriod as "LUNCH" | "DINNER",
      },
    });

    expect(reservations).toHaveLength(1);
    expect(sendReservationEmailMock).toHaveBeenCalledTimes(1);
  }, 30000);

  it("creates a new reservation when the party size is different", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const payload = buildPayload();

    await POST(buildRequest(payload));
    const response = await POST(
      buildRequest({
        ...payload,
        partySize: 3,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deduplicated).toBe(false);

    const reservations = await prisma!.reservation.findMany({
      where: {
        date: payload.date as string,
        servicePeriod: payload.servicePeriod as "LUNCH" | "DINNER",
      },
      orderBy: [{ createdAt: "asc" }],
    });

    expect(reservations).toHaveLength(2);
    expect(reservations.map((reservation) => reservation.partySize)).toEqual([2, 3]);
    expect(sendReservationEmailMock).toHaveBeenCalledTimes(2);
  }, 30000);

  it("creates a new reservation when the prior one is older than 1 minute", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const payload = buildPayload();

    const firstResponse = await POST(buildRequest(payload));
    const firstBody = await firstResponse.json();

    await prisma!.reservation.update({
      where: { id: firstBody.reservationId },
      data: { createdAt: new Date(Date.now() - 2 * 60 * 1000) },
    });

    const secondResponse = await POST(buildRequest(payload));
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondBody.deduplicated).toBe(false);
    expect(secondBody.reservationId).not.toBe(firstBody.reservationId);

    const reservations = await prisma!.reservation.findMany({
      where: {
        date: payload.date as string,
        servicePeriod: payload.servicePeriod as "LUNCH" | "DINNER",
      },
    });

    expect(reservations).toHaveLength(2);
    expect(sendReservationEmailMock).toHaveBeenCalledTimes(2);
  }, 30000);
});
