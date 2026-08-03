import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatJst } from "@/lib/dates";
import { getNextBookableReservationDate } from "@/lib/booking-rules";
import { clearReservationArtifacts } from "./utils/reservation-destructive-cleanup";
import { createTestPrismaClient, destructiveTestDbAccess } from "./test-database";

const hasSafeDatabase = destructiveTestDbAccess.enabled;
const describeIfDatabase = hasSafeDatabase ? describe : describe.skip;
const prisma = hasSafeDatabase ? createTestPrismaClient() : null;

if (!hasSafeDatabase) {
  console.warn(`[tests] Skipping destructive DB tests: ${destructiveTestDbAccess.reason}`);
}

function buildRequest(body: Record<string, unknown>, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: "http://localhost:3000",
    "x-requested-with": "XMLHttpRequest",
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

  return new NextRequest("http://localhost:3000/api/reservations", {
    method: "POST",
    headers,
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

async function cleanupReservations() {
  await clearReservationArtifacts(getPrismaOrThrow());
}

function getPrismaOrThrow() {
  if (!prisma) {
    throw new Error("Safe TEST_DATABASE_URL and ALLOW_DESTRUCTIVE_TEST_DB=1 are required");
  }
  return prisma;
}

describeIfDatabase("reservations route duplicate guard (db)", () => {
  beforeEach(async () => {
    vi.resetModules();
    await cleanupReservations();
  });

  afterAll(async () => {
    await cleanupReservations();
    await getPrismaOrThrow().$disconnect();
  });

  it("returns the existing reservation for duplicate submissions within 1 minute", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const payload = buildPayload();

    const firstResponse = await POST(buildRequest(payload, "legacy-duplicate-first"));
    const firstBody = await firstResponse.json();

    const secondResponse = await POST(
      buildRequest({
        ...payload,
        name: " 山田 花子 ",
        phone: "09012345678",
      }, "legacy-duplicate-second")
    );
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstBody.deduplicated).toBe(false);
    expect(secondResponse.status).toBe(200);
    expect(secondBody.deduplicated).toBe(true);
    expect(secondBody.reservationId).toBe(firstBody.reservationId);

    const reservations = await getPrismaOrThrow().reservation.findMany({
      where: {
        date: payload.date as string,
        servicePeriod: payload.servicePeriod as "LUNCH" | "DINNER",
      },
    });

    expect(reservations).toHaveLength(1);
    const emailOutbox = await getPrismaOrThrow().reservationEmailOutbox.findMany({
      where: { reservationId: firstBody.reservationId },
    });
    expect(emailOutbox).toHaveLength(1);
    expect(emailOutbox[0]).toMatchObject({
      notificationType: "RESERVATION_CONFIRMATION",
      status: "PENDING",
      attempts: 0,
    });
  }, 30000);

  it("creates a new reservation when the party size is different", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const payload = buildPayload();

    await POST(buildRequest(payload, "different-size-first"));
    const response = await POST(
      buildRequest({
        ...payload,
        partySize: 3,
      }, "different-size-second")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.deduplicated).toBe(false);

    const reservations = await getPrismaOrThrow().reservation.findMany({
      where: {
        date: payload.date as string,
        servicePeriod: payload.servicePeriod as "LUNCH" | "DINNER",
      },
      orderBy: [{ createdAt: "asc" }],
    });

    expect(reservations).toHaveLength(2);
    expect(reservations.map((reservation) => reservation.partySize)).toEqual([2, 3]);
    await expect(
      getPrismaOrThrow().reservationEmailOutbox.count()
    ).resolves.toBe(2);
  }, 30000);

  it("creates a new reservation when the prior one is older than 1 minute", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const payload = buildPayload();

    const firstResponse = await POST(buildRequest(payload, "stale-first"));
    const firstBody = await firstResponse.json();

    const staleCreatedAt = new Date(Date.now() - 5 * 60 * 1000);
    await getPrismaOrThrow().reservation.update({
      where: { id: firstBody.reservationId },
      data: { createdAt: staleCreatedAt },
    });

    const secondResponse = await POST(buildRequest(payload, "stale-second"));
    const secondBody = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(secondBody.deduplicated).toBe(false);
    expect(secondBody.reservationId).not.toBe(firstBody.reservationId);

    const reservations = await getPrismaOrThrow().reservation.findMany({
      where: {
        date: payload.date as string,
        servicePeriod: payload.servicePeriod as "LUNCH" | "DINNER",
      },
    });

    expect(reservations).toHaveLength(2);
    await expect(
      getPrismaOrThrow().reservationEmailOutbox.count()
    ).resolves.toBe(2);
  }, 30000);

  it("replays the saved response after the original response was lost for minutes", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const payload = buildPayload();
    const idempotencyKey = "response-loss-after-minutes";

    const firstResponse = await POST(buildRequest(payload, idempotencyKey));
    const firstBody = await firstResponse.json();
    expect(firstResponse.status).toBe(200);

    await getPrismaOrThrow().reservationIdempotency.update({
      where: { idempotencyKey },
      data: { createdAt: new Date(Date.now() - 5 * 60 * 1000) },
    });

    const replayResponse = await POST(buildRequest(payload, idempotencyKey));
    const replayBody = await replayResponse.json();

    expect(replayResponse.status).toBe(200);
    expect(replayBody).toEqual(firstBody);
    await expect(getPrismaOrThrow().reservation.count()).resolves.toBe(1);
    await expect(getPrismaOrThrow().reservationEmailOutbox.count()).resolves.toBe(1);
  }, 30000);

  it("returns the same saved response for concurrent requests with the same key", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const payload = buildPayload();
    const idempotencyKey = "concurrent-same-key";

    const [firstResponse, secondResponse] = await Promise.all([
      POST(buildRequest(payload, idempotencyKey)),
      POST(buildRequest(payload, idempotencyKey)),
    ]);
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondBody).toEqual(firstBody);
    await expect(getPrismaOrThrow().reservation.count()).resolves.toBe(1);
    await expect(getPrismaOrThrow().reservationEmailOutbox.count()).resolves.toBe(1);
  }, 30000);

  it("returns 409 when the same key is reused with a different body", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const payload = buildPayload();
    const idempotencyKey = "different-body-conflict";

    const firstResponse = await POST(buildRequest(payload, idempotencyKey));
    expect(firstResponse.status).toBe(200);

    const conflictResponse = await POST(
      buildRequest({ ...payload, partySize: 3 }, idempotencyKey)
    );
    const conflictBody = await conflictResponse.json();

    expect(conflictResponse.status).toBe(409);
    expect(conflictBody.code).toBe("IDEMPOTENCY_CONFLICT");
    await expect(getPrismaOrThrow().reservation.count()).resolves.toBe(1);
  }, 30000);
});
