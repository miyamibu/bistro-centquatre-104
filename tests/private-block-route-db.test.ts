import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ReservationStatus, ReservationType } from "@prisma/client";
import {
  createTestPrismaClient,
  safeTestDatabaseUrl,
  summarizeDatabaseUrl,
} from "./test-database";

const PRIVATE_BLOCK_TEST_CODE = "test-private-block-code";
process.env.PRIVATE_BLOCK_ACCESS_CODE ??= PRIVATE_BLOCK_TEST_CODE;

const hasSafeDatabase = Boolean(safeTestDatabaseUrl);
const describeIfDatabase = hasSafeDatabase ? describe : describe.skip;
const prisma = hasSafeDatabase ? createTestPrismaClient() : null;
const hasAdminCredentials =
  Boolean(process.env.ADMIN_BASIC_USER) && Boolean(process.env.ADMIN_BASIC_PASS);
const itIfAdmin = hasAdminCredentials ? it : it.skip;

if (process.env.TEST_DATABASE_URL && !hasSafeDatabase) {
  console.warn(
    `[tests] Skipping destructive DB tests because TEST_DATABASE_URL is not a safe local test database: ${summarizeDatabaseUrl(process.env.TEST_DATABASE_URL)}`
  );
}

if (!process.env.TEST_DATABASE_URL) {
  console.warn("[tests] Skipping destructive DB tests because TEST_DATABASE_URL is not set");
}

function buildReservationRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/reservations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

async function postPrivateBlock(body: {
  date: string;
  servicePeriod: "LUNCH" | "DINNER";
  note?: string;
}) {
  const { POST: postReservation } = await import("@/app/api/reservations/route");
  const arrivalTime = body.servicePeriod === "LUNCH" ? "11:30" : "18:00";
  const response = await postReservation(
    buildReservationRequest({
      reservationType: "PRIVATE_BLOCK",
      privateBlockAccessCode: process.env.PRIVATE_BLOCK_ACCESS_CODE ?? PRIVATE_BLOCK_TEST_CODE,
      date: body.date,
      arrivalTime,
      lastName: "貸切",
      firstName: "テスト",
      phone: "09000000000",
      note: body.note,
    })
  );

  const json = await response.json().catch(() => null);
  return {
    status: response.status,
    body: json,
  };
}

async function clearReservationArtifacts() {
  if (!prisma) {
    throw new Error("Safe TEST_DATABASE_URL is required for destructive DB tests");
  }

  await prisma.$executeRawUnsafe('DELETE FROM "PrivateBlockAuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "ReservationRateLimitEvent"');
  await prisma.$executeRawUnsafe('DELETE FROM "Reservation"');
}

function buildAdminPatchRequest(id: string, body: unknown) {
  const basicToken = Buffer.from(
    `${process.env.ADMIN_BASIC_USER}:${process.env.ADMIN_BASIC_PASS}`
  ).toString("base64");

  return new NextRequest(`http://localhost:3000/api/admin/reservations/${id}`, {
    method: "PATCH",
    headers: {
      authorization: `Basic ${basicToken}`,
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

describeIfDatabase("private block route contract (db)", () => {
  beforeAll(async () => {
    await clearReservationArtifacts();
  });

  beforeEach(async () => {
    await clearReservationArtifacts();
  });

  afterAll(async () => {
    await clearReservationArtifacts();
    await prisma.$disconnect();
  });

  it("returns CREATED then NO_OP and persists audit logs", async () => {
    const payload = {
      date: "2099-12-30",
      servicePeriod: "DINNER" as const,
      note: "監査テスト: 企業会食",
    };

    const created = await postPrivateBlock(payload);
    expect(created.status).toBe(201);
    expect(created.body?.result).toBe("CREATED");

    const noop = await postPrivateBlock(payload);
    expect(noop.status).toBe(200);
    expect(noop.body?.result).toBe("NO_OP");

    const auditRows = await prisma.$queryRaw<Array<{ result: string }>>`
      SELECT "result"
      FROM "PrivateBlockAuditLog"
      WHERE "date" = ${payload.date}
        AND "servicePeriod" = CAST(${payload.servicePeriod} AS "ServicePeriod")
      ORDER BY "createdAt" ASC
    `;

    expect(auditRows.map((row) => row.result)).toEqual(["CREATED", "NO_OP"]);
  });

  it("returns CONFLICT when confirmed normal reservation exists", async () => {
    const payload = {
      date: "2099-12-29",
      servicePeriod: "LUNCH" as const,
      note: "監査テスト: 競合",
    };

    await prisma.reservation.create({
      data: {
        date: payload.date,
        servicePeriod: payload.servicePeriod,
        reservationType: ReservationType.NORMAL,
        seatType: "MAIN",
        partySize: 2,
        arrivalTime: "12:00",
        name: "通常予約 テスト",
        phone: "09011112222",
        note: "競合テスト",
        status: ReservationStatus.CONFIRMED,
        lineUserId: null,
      },
    });

    const conflict = await postPrivateBlock(payload);
    expect(conflict.status).toBe(409);
    expect(conflict.body?.result).toBe("CONFLICT");
  });

  it("handles concurrent POST with one CREATED and one NO_OP", async () => {
    const payload = {
      date: "2099-12-28",
      servicePeriod: "DINNER" as const,
      note: "監査テスト: 同時POST",
    };

    const [left, right] = await Promise.all([postPrivateBlock(payload), postPrivateBlock(payload)]);
    const statuses = [left.status, right.status].sort((a, b) => a - b);
    const results = [left.body?.result, right.body?.result].sort();

    expect(statuses).toEqual([200, 201]);
    expect(results).toEqual(["CREATED", "NO_OP"]);

    const activePrivateBlocks = await prisma.reservation.count({
      where: {
        date: payload.date,
        servicePeriod: payload.servicePeriod,
        reservationType: ReservationType.PRIVATE_BLOCK,
        status: ReservationStatus.CONFIRMED,
      },
    });
    expect(activePrivateBlocks).toBe(1);
  });

  itIfAdmin("requires operatorName for private-block release and writes RELEASED audit", async () => {
    const created = await postPrivateBlock({
      date: "2099-12-27",
      servicePeriod: "LUNCH",
      note: "監査テスト: 解除",
    });

    expect(created.status).toBe(201);
    const reservationId = created.body?.reservationId as string;

    const { PATCH: patchAdminReservation } = await import("@/app/api/admin/reservations/[id]/route");

    const missingOperatorResponse = await patchAdminReservation(
      buildAdminPatchRequest(reservationId, {
        status: ReservationStatus.CANCELLED,
      }),
      { params: Promise.resolve({ id: reservationId }) }
    );

    expect(missingOperatorResponse.status).toBe(400);

    const releasedResponse = await patchAdminReservation(
      buildAdminPatchRequest(reservationId, {
        status: ReservationStatus.CANCELLED,
        operatorName: "運用担当A",
      }),
      { params: Promise.resolve({ id: reservationId }) }
    );

    expect(releasedResponse.status).toBe(200);

    const auditRows = await prisma.$queryRaw<Array<{ result: string; actorName: string | null }>>`
      SELECT "result", "actorName"
      FROM "PrivateBlockAuditLog"
      WHERE "reservationId" = ${reservationId}
      ORDER BY "createdAt" ASC
    `;

    expect(auditRows.some((row) => row.result === "RELEASED")).toBe(true);
    expect(auditRows.find((row) => row.result === "RELEASED")?.actorName).toBe("運用担当A");
  });
});
