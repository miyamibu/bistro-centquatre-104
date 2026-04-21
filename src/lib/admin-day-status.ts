import { ReservationStatus, ReservationType, type BusinessDay } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ensureReservationSchemaReady,
  findReservationsCompat,
} from "@/lib/reservation-compat";
import { parseReservationNote } from "@/lib/reservation-note";

type ReservationRow = Awaited<ReturnType<typeof findReservationsCompat>>[number];

const ACTIVE_STATUS_FILTER = {
  not: ReservationStatus.CANCELLED,
} as const;

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
  businessDayByDate: Map<string, BusinessDay>;
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

function collectUniqueLastNames(rows: ReservationRow[], servicePeriod: "LUNCH" | "DINNER") {
  return rows.reduce<string[]>((acc, row) => {
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

function buildPeriodStatus(
  reservations: ReservationRow[],
  servicePeriod: "LUNCH" | "DINNER"
): AdminDayPeriodStatus {
  const inPeriod = reservations.filter((row) => row.servicePeriod === servicePeriod);
  const privateBlock = inPeriod.find((row) => row.reservationType === ReservationType.PRIVATE_BLOCK);
  const normalReservations = inPeriod.filter(
    (row) => row.reservationType !== ReservationType.PRIVATE_BLOCK
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

function buildDayStatus(date: string, businessDay: BusinessDay | null, reservations: ReservationRow[]) {
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

function buildReservationsByDate(reservations: ReservationRow[]): Record<string, ReservationRow[]> {
  return reservations.reduce<Record<string, ReservationRow[]>>((acc, row) => {
    const current = acc[row.date] ?? [];
    current.push(row);
    acc[row.date] = current;
    return acc;
  }, {});
}

function buildMonthQueryData(
  dateKeys: string[],
  businessDays: BusinessDay[],
  reservations: ReservationRow[]
): AdminMonthQueryData {
  return {
    dateKeys,
    businessDayByDate: new Map<string, BusinessDay>(
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
    }),
    findReservationsCompat(prisma, {
      where: {
        date: { in: dateKeys },
        status: ACTIVE_STATUS_FILTER,
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  return buildMonthQueryData(dateKeys, businessDays, reservations);
}

export async function getAdminDayStatus(date: string): Promise<AdminDayStatus> {
  await ensureReservationSchemaReady(prisma);

  const [businessDay, reservations] = await Promise.all([
    prisma.businessDay.findUnique({ where: { date } }),
    findReservationsCompat(prisma, {
      where: {
        date,
        status: ACTIVE_STATUS_FILTER,
      },
      orderBy: [{ createdAt: "asc" }],
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
