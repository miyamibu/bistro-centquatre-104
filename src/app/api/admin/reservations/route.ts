import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ReservationStatus } from "@prisma/client";
import { getStaffAuth } from "@/lib/staff-auth";
import { apiError } from "@/lib/api-security";
import { getRequestId, logError } from "@/lib/logger";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  findReservationsCompat,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";

export const dynamic = "force-dynamic";
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1_000;

const ADMIN_RESERVATION_LIST_SELECT = {
  id: true,
  date: true,
  servicePeriod: true,
  reservationType: true,
  seatType: true,
  partySize: true,
  arrivalTime: true,
  name: true,
  phone: true,
  note: true,
  status: true,
  lineUserId: true,
  lineReminderStatus: true,
  lineReminderError: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/admin/reservations";

  if (!(await getStaffAuth())) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  try {
    await ensureReservationSchemaReady(prisma);

    const params = request.nextUrl.searchParams;
    const pageParam = params.get("page") ?? "1";
    const pageSizeParam = params.get("pageSize") ?? String(DEFAULT_PAGE_SIZE);
    const page = Number(pageParam);
    const pageSize = Number(pageSizeParam);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > MAX_PAGE ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_PAGE_SIZE
    ) {
      return apiError(400, {
        error: "page and pageSize are out of bounds",
        code: "INVALID_PAGINATION",
        requestId,
      });
    }
    const date = params.get("date");
    const statusParam = params.get("status");
    const status =
      statusParam && Object.values(ReservationStatus).includes(statusParam as ReservationStatus)
        ? (statusParam as ReservationStatus)
        : undefined;
    if (statusParam && !status) {
      return apiError(400, {
        error: "status is invalid",
        code: "INVALID_STATUS",
        requestId,
      });
    }

    const reservations = await findReservationsCompat(prisma, {
      where: {
        date: date ?? undefined,
        status,
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: ADMIN_RESERVATION_LIST_SELECT,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return NextResponse.json(reservations, {
      headers: {
        "X-Page": String(page),
        "X-Page-Size": String(pageSize),
        "X-Has-More": String(reservations.length === pageSize),
      },
    });
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    logError("admin.reservations.fetch.failed", {
      requestId,
      route,
      errorCode: "ADMIN_RESERVATIONS_FETCH_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to fetch reservations",
      code: "ADMIN_RESERVATIONS_FETCH_FAILED",
      requestId,
    });
  }
}
