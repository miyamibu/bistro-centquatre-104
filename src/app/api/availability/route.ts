import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAvailability } from "@/lib/availability";
import { apiError } from "@/lib/api-security";
import { getRequestId, logError } from "@/lib/logger";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";
import { dateStringSchema, reservationServicePeriodSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  const date = request.nextUrl.searchParams.get("date");
  if (!date) {
    return apiError(400, {
      error: "date is required",
      code: "MISSING_DATE",
      requestId,
    });
  }

  const parsedDate = dateStringSchema.safeParse(date);
  if (!parsedDate.success) {
    return apiError(400, {
      error: "date must be YYYY-MM-DD format",
      code: "INVALID_DATE",
      requestId,
    });
  }

  const servicePeriod = request.nextUrl.searchParams.get("servicePeriod");
  if (!servicePeriod) {
    return apiError(400, {
      error: "servicePeriod is required",
      code: "MISSING_SERVICE_PERIOD",
      requestId,
    });
  }

  const parsedServicePeriod = reservationServicePeriodSchema.safeParse(servicePeriod);
  if (!parsedServicePeriod.success) {
    return apiError(400, {
      error: "servicePeriod must be LUNCH or DINNER",
      code: "INVALID_SERVICE_PERIOD",
      requestId,
    });
  }

  const partySizeParam = request.nextUrl.searchParams.get("partySize");
  if (!partySizeParam) {
    return apiError(400, {
      error: "partySize is required",
      code: "MISSING_PARTY_SIZE",
      requestId,
    });
  }

  const partySize = Number(partySizeParam);
  if (!Number.isInteger(partySize) || partySize < 1) {
    return apiError(400, {
      error: "partySize must be a positive integer",
      code: "INVALID_PARTY_SIZE",
      requestId,
    });
  }

  try {
    await ensureReservationSchemaReady(prisma);

    const availability = await getAvailability(
      {
        date,
        servicePeriod: parsedServicePeriod.data,
        partySize,
      },
      prisma
    );
    return NextResponse.json(availability, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    logError("availability.fetch.failed", {
      requestId,
      route: "/api/availability",
      errorCode: "AVAILABILITY_FETCH_FAILED",
      context: {
        date,
        servicePeriod,
        partySize,
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return apiError(500, {
      error: "Failed to fetch availability",
      code: "AVAILABILITY_FETCH_FAILED",
      requestId,
    });
  }
}
