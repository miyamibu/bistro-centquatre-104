import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  enforceReservationWriteRateLimit,
  isReservationRateLimitError,
} from "@/lib/reservation-rate-limit";
import { clearReservationArtifacts } from "./utils/reservation-destructive-cleanup";
import { createTestPrismaClient, destructiveTestDbAccess } from "./test-database";

const describeIfDatabase = destructiveTestDbAccess.enabled ? describe : describe.skip;
const prisma = destructiveTestDbAccess.enabled ? createTestPrismaClient() : null;

if (!destructiveTestDbAccess.enabled) {
  console.warn(`[tests] Skipping destructive DB tests: ${destructiveTestDbAccess.reason}`);
}

function getPrismaOrThrow() {
  if (!prisma) {
    throw new Error("Safe TEST_DATABASE_URL and ALLOW_DESTRUCTIVE_TEST_DB=1 are required");
  }
  return prisma;
}

describeIfDatabase("reservation rate limit atomicity (db)", () => {
  beforeEach(async () => {
    await clearReservationArtifacts(getPrismaOrThrow());
  });

  afterAll(async () => {
    await clearReservationArtifacts(getPrismaOrThrow());
    await getPrismaOrThrow().$disconnect();
  });

  it("allows only one request at the limit boundary under parallel load", async () => {
    const ipHash = `rate-limit-test-${randomUUID()}`;

    for (let index = 0; index < 39; index += 1) {
      await enforceReservationWriteRateLimit(getPrismaOrThrow(), { ipHash });
    }

    const results = await Promise.allSettled([
      enforceReservationWriteRateLimit(getPrismaOrThrow(), { ipHash }),
      enforceReservationWriteRateLimit(getPrismaOrThrow(), { ipHash }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status === "rejected" && isReservationRateLimitError(rejected[0].reason)).toBe(
      true
    );
    await expect(
      getPrismaOrThrow().reservationRateLimitEvent.count({
        where: { keyHash: ipHash, scope: "IP" },
      })
    ).resolves.toBe(40);
  }, 30000);
});
