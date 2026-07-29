import type { PrismaClient } from "@prisma/client";
import { assertDestructiveCleanupAllowed } from "./assert-test-database";

// RESERVATION_DESTRUCTIVE_TEST_ONLY
// This helper is the only allowlisted destructive cleanup path and must remain test-DB only.

type CleanupOptions = {
  includePrivateBlockAuditLog?: boolean;
};

export async function clearReservationArtifacts(
  prisma: PrismaClient,
  options: CleanupOptions = {}
) {
  assertDestructiveCleanupAllowed();

  if (options.includePrivateBlockAuditLog) {
    await prisma.$executeRawUnsafe('DELETE FROM "PrivateBlockAuditLog"');
  }

  await prisma.$executeRawUnsafe('DELETE FROM "ReservationRateLimitEvent"');
  await prisma.$executeRawUnsafe('DELETE FROM "ReservationEmailOutbox"');
  await prisma.$executeRawUnsafe('DELETE FROM "NotificationEvent"');
  await prisma.$executeRawUnsafe('DELETE FROM "ReservationStatusAuditLog"');
  await prisma.$executeRawUnsafe('DELETE FROM "ReservationLineLinkToken"');
  await prisma.$executeRawUnsafe('DELETE FROM "Reservation"');
}
