import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ReservationStatus } from "@prisma/client";
import { isAuthorized } from "@/lib/basic-auth";
import { apiError } from "@/lib/api-security";
import { getRequestId, logError } from "@/lib/logger";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  findReservationsCompat,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/admin/reservations";

  if (!isAuthorized(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  try {
    await ensureReservationSchemaReady(prisma);

    const params = request.nextUrl.searchParams;
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
    });

    return NextResponse.json(reservations);
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
