import type { Prisma } from "@prisma/client";
import { buildReservationAdvisoryLockKey } from "@/lib/reservation-lock";

export async function acquireReservationAdvisoryLock(
  tx: Prisma.TransactionClient,
  date: string,
  servicePeriod: string,
) {
  await tx.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    buildReservationAdvisoryLockKey(date, servicePeriod),
  );
}
