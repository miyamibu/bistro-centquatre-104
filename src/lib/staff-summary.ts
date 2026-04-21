import { ReservationStatus, ReservationType } from "@prisma/client";
import { getPrivateBlockMarkerText } from "@/lib/booking-rules";
import { formatJst } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { ensureReservationSchemaReady, findReservationsCompat } from "@/lib/reservation-compat";

const ACTIVE_RESERVATION_STATUS_FILTER = {
  not: ReservationStatus.CANCELLED,
} as const;

export interface StaffDaySummary {
  date: string;
  isClosed: boolean;
  businessDayNote: string | null;
  normalReservationCount: number;
  normalPartyTotal: number;
  privateBlockCount: number;
  lunchPrivateBlocked: boolean;
  dinnerPrivateBlocked: boolean;
  privateBlockMarkerText: ReturnType<typeof getPrivateBlockMarkerText>;
}

export function getStaffServiceStatusLabel(summary: StaffDaySummary) {
  if (summary.isClosed) {
    return "休業日";
  }

  if (summary.privateBlockMarkerText === "終日貸切") {
    return "終日貸切";
  }

  if (summary.privateBlockMarkerText === "夜のみ") {
    return "ランチ貸切（ディナー営業）";
  }

  if (summary.privateBlockMarkerText === "昼のみ") {
    return "ディナー貸切（ランチ営業）";
  }

  return "通常営業";
}

export async function getStaffDaySummary(date = formatJst(new Date())): Promise<StaffDaySummary> {
  await ensureReservationSchemaReady(prisma);

  const [businessDay, reservations] = await Promise.all([
    prisma.businessDay.findUnique({ where: { date } }),
    findReservationsCompat(prisma, {
      where: {
        date,
        status: ACTIVE_RESERVATION_STATUS_FILTER,
      },
      orderBy: [{ createdAt: "asc" }],
    }),
  ]);

  const normalReservations = reservations.filter(
    (row) => row.reservationType !== ReservationType.PRIVATE_BLOCK
  );
  const privateBlocks = reservations.filter(
    (row) => row.reservationType === ReservationType.PRIVATE_BLOCK
  );

  const lunchPrivateBlocked = privateBlocks.some((row) => row.servicePeriod === "LUNCH");
  const dinnerPrivateBlocked = privateBlocks.some((row) => row.servicePeriod === "DINNER");
  const privateBlockMarkerText = getPrivateBlockMarkerText(
    lunchPrivateBlocked ? "PRIVATE_BLOCK" : undefined,
    dinnerPrivateBlocked ? "PRIVATE_BLOCK" : undefined
  );

  return {
    date,
    isClosed: businessDay?.isClosed ?? false,
    businessDayNote: businessDay?.note ?? null,
    normalReservationCount: normalReservations.length,
    normalPartyTotal: normalReservations.reduce((sum, row) => sum + row.partySize, 0),
    privateBlockCount: privateBlocks.length,
    lunchPrivateBlocked,
    dinnerPrivateBlocked,
    privateBlockMarkerText,
  };
}
