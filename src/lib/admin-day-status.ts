import { ReservationType, type BusinessDay } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ensureReservationSchemaReady,
  findReservationsCompat,
} from "@/lib/reservation-compat";
import { parseReservationNote } from "@/lib/reservation-note";
import { isCapacityBlockingReservation } from "@/lib/reservation-capacity";

type ReservationRow = Awaited<ReturnType<typeof findReservationsCompat>>[number];
export type AdminDayReservationRow = Pick<
  ReservationRow,
  "id" | "date" | "servicePeriod" | "reservationType" | "status" | "partySize" | "name" | "note"
>;
type BusinessDayRow = Pick<BusinessDay, "date" | "isClosed" | "note">;

export type AdminDayPeriodStatus = {
  privateBlock: {
    active: boolean;
    id: string | null;
  };
  reservations: {
    count: number;
    partyTotal: number;
    names: string[];
    lastNames: string[];
    memoEntries: Array<{
      lastName: string;
      note: string | null;
    }>;
  };
};

export type AdminDayStatus = {
  date: string;
  isClosed: boolean;
  note: string | null;
  lunch: AdminDayPeriodStatus;
  dinner: AdminDayPeriodStatus;
};

export type AdminMonthDaySummary = {
  date: string;
  isClosed: boolean;
  hasLunchPrivateBlock: boolean;
  hasDinnerPrivateBlock: boolean;
  normalReservationCount: number;
  lunchReservationLastNames: string[];
  dinnerReservationLastNames: string[];
  normalReservationLastNames: string[];
  hasConflict: boolean;
};

export type AdminMonthStatus = {
  month: string;
  days: Record<string, AdminMonthDaySummary>;
};

type AdminMonthQueryData = {
  dateKeys: string[];
  businessDayByDate: Map<string, BusinessDayRow>;
  reservationsByDate: Record<string, ReservationRow[]>;
};

function parseMonthInput(month: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    throw new Error("INVALID_MONTH");
  }

  const year = Number(match[1]);
  const monthNum = Number(match[2]);
  if (!year || monthNum < 1 || monthNum > 12) {
    throw new Error("INVALID_MONTH");
  }

  return { year, monthIndex: monthNum - 1 };
}

function parseDateInput(date: string): { year: number; month: number; day: number; monthKey: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error("INVALID_DATE");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error("INVALID_DATE");
  }

  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error("INVALID_DATE");
  }

  return {
    year,
    month,
    day,
    monthKey: `${match[1]}-${match[2]}`,
  };
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function normalizeAdminReservationDateInput(
  value: string | null | undefined,
  fallbackDate: string
) {
  const trimmed = value?.trim();
  const fallback = /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate) ? fallbackDate : "2026-01-01";

  if (!trimmed) {
    return fallback;
  }

  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (!match) {
    return fallback;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    !year ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return fallback;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function getDateKeysForMonth(month: string) {
  const { year, monthIndex } = parseMonthInput(month);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
  });
}

function extractLastName(fullName: string): string {
  const normalized = fullName.trim();
  if (!normalized) return "";
  const parts = normalized.split(/[\s　]+/).filter(Boolean);
  return parts[0] ?? "";
}

function collectUniqueLastNames(rows: AdminDayReservationRow[], servicePeriod: "LUNCH" | "DINNER") {
  return rows.reduce<string[]>((acc, row) => {
    if (!isCapacityBlockingReservation(row)) return acc;
    if (row.reservationType === ReservationType.PRIVATE_BLOCK) return acc;
    if (row.servicePeriod !== servicePeriod) return acc;
    const lastName = extractLastName(row.name);
    if (!lastName) return acc;
    if (!acc.includes(lastName)) {
      acc.push(lastName);
    }
    return acc;
  }, []);
}

export function buildPeriodStatus(
  reservations: AdminDayReservationRow[],
  servicePeriod: "LUNCH" | "DINNER"
): AdminDayPeriodStatus {
  const inPeriod = reservations.filter((row) => row.servicePeriod === servicePeriod);
  const privateBlock = inPeriod.find(
    (row) =>
      isCapacityBlockingReservation(row) &&
      row.reservationType === ReservationType.PRIVATE_BLOCK
  );
  const normalReservations = inPeriod.filter(
    (row) =>
      isCapacityBlockingReservation(row) &&
      row.reservationType !== ReservationType.PRIVATE_BLOCK
  );
  const memoEntries = normalReservations.map((row) => {
    const parsed = parseReservationNote(row.note);
    return {
      lastName: extractLastName(row.name),
      note: parsed.note,
    };
  });

  return {
    privateBlock: {
      active: Boolean(privateBlock),
      id: privateBlock?.id ?? null,
    },
    reservations: {
      count: normalReservations.length,
      partyTotal: normalReservations.reduce((sum, row) => sum + row.partySize, 0),
      names: normalReservations.map((row) => row.name),
      lastNames: normalReservations.map((row) => extractLastName(row.name)),
      memoEntries,
    },
  };
}

function buildDayStatus(
  date: string,
  businessDay: BusinessDayRow | null,
  reservations: AdminDayReservationRow[]
) {
  const lunch = buildPeriodStatus(reservations, "LUNCH");
  const dinner = buildPeriodStatus(reservations, "DINNER");
  return {
    date,
    isClosed: businessDay?.isClosed ?? false,
    note: businessDay?.note ?? null,
    lunch,
    dinner,
  } satisfies AdminDayStatus;
}

function buildReservationsByDate(
  reservations: ReservationRow[]
): Record<string, ReservationRow[]> {
  return reservations.reduce<Record<string, ReservationRow[]>>((acc, row) => {
    const current = acc[row.date] ?? [];
    current.push(row);
    acc[row.date] = current;
    return acc;
  }, {});
}

function buildMonthQueryData(
  dateKeys: string[],
  businessDays: BusinessDayRow[],
  reservations: ReservationRow[]
): AdminMonthQueryData {
  return {
    dateKeys,
    businessDayByDate: new Map<string, BusinessDayRow>(
      businessDays.map((businessDay) => [businessDay.date, businessDay])
    ),
    reservationsByDate: buildReservationsByDate(reservations),
  };
}

function buildDayStatusFromMonthQueryData(date: string, monthData: AdminMonthQueryData) {
  return buildDayStatus(
    date,
    monthData.businessDayByDate.get(date) ?? null,
    monthData.reservationsByDate[date] ?? []
  );
}

function buildMonthDaysFromQueryData(
  monthData: AdminMonthQueryData
): Record<string, AdminMonthDaySummary> {
  return monthData.dateKeys.reduce<Record<string, AdminMonthDaySummary>>((acc, date) => {
    const dayReservations = monthData.reservationsByDate[date] ?? [];
    const dayStatus = buildDayStatusFromMonthQueryData(date, monthData);
    const hasLunchPrivateBlock = dayStatus.lunch.privateBlock.active;
    const hasDinnerPrivateBlock = dayStatus.dinner.privateBlock.active;
    const normalReservationCount =
      dayStatus.lunch.reservations.count + dayStatus.dinner.reservations.count;
    const lunchReservationLastNames = collectUniqueLastNames(dayReservations, "LUNCH");
    const dinnerReservationLastNames = collectUniqueLastNames(dayReservations, "DINNER");
    const normalReservationLastNames = [...lunchReservationLastNames, ...dinnerReservationLastNames];

    acc[date] = {
      date,
      isClosed: dayStatus.isClosed,
      hasLunchPrivateBlock,
      hasDinnerPrivateBlock,
      normalReservationCount,
      lunchReservationLastNames,
      dinnerReservationLastNames,
      normalReservationLastNames,
      hasConflict: dayStatus.isClosed && (hasLunchPrivateBlock || hasDinnerPrivateBlock),
    };
    return acc;
  }, {});
}

async function fetchMonthQueryData(month: string): Promise<AdminMonthQueryData> {
  await ensureReservationSchemaReady(prisma);

  const dateKeys = getDateKeysForMonth(month);
  const [businessDays, reservations] = await Promise.all([
    prisma.businessDay.findMany({
      where: {
        date: { in: dateKeys },
      },
      select: {
        date: true,
        isClosed: true,
        note: true,
      },
    }),
    findReservationsCompat(prisma, {
      where: {
        date: { in: dateKeys },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        date: true,
        servicePeriod: true,
        reservationType: true,
        partySize: true,
        arrivalTime: true,
        name: true,
        phone: true,
        note: true,
        status: true,
        lineUserId: true,
        lineReminderStatus: true,
        lineReminderError: true,
      },
    }),
  ]);

  return buildMonthQueryData(dateKeys, businessDays, reservations);
}

export async function getAdminDayStatus(date: string): Promise<AdminDayStatus> {
  await ensureReservationSchemaReady(prisma);

  const [businessDay, reservations] = await Promise.all([
    prisma.businessDay.findUnique({
      where: { date },
      select: {
        date: true,
        isClosed: true,
        note: true,
      },
    }),
    findReservationsCompat(prisma, {
      where: {
        date,
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        date: true,
        servicePeriod: true,
        reservationType: true,
        partySize: true,
        arrivalTime: true,
        name: true,
        phone: true,
        note: true,
        status: true,
        lineUserId: true,
        lineReminderStatus: true,
        lineReminderError: true,
      },
    }),
  ]);

  return buildDayStatus(date, businessDay, reservations);
}

export async function getAdminMonthStatus(month: string): Promise<AdminMonthStatus> {
  const monthData = await fetchMonthQueryData(month);
  const days = buildMonthDaysFromQueryData(monthData);
  return { month, days };
}

export async function getAdminReservationsPageData(date: string): Promise<{
  monthDays: Record<string, AdminMonthDaySummary>;
  dayStatus: AdminDayStatus;
  reservations: Awaited<ReturnType<typeof findReservationsCompat>>;
}> {
  const { monthKey } = parseDateInput(date);
  const monthData = await fetchMonthQueryData(monthKey);
  return {
    monthDays: buildMonthDaysFromQueryData(monthData),
    dayStatus: buildDayStatusFromMonthQueryData(date, monthData),
    reservations: monthData.reservationsByDate[date] ?? [],
  };
}
