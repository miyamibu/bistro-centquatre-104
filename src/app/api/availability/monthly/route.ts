import { NextRequest, NextResponse } from "next/server";
import { getMonthlyAvailability } from "@/lib/availability";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api-security";
import { getRequestId, logError } from "@/lib/logger";
import {
  RESERVATION_SCHEMA_NOT_READY_CODE,
  ensureReservationSchemaReady,
  isReservationSchemaNotReadyError,
} from "@/lib/reservation-compat";
import {
  monthStringSchema,
  reservationServicePeriodSchema,
} from "@/lib/validation";
import {
  AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS,
  enforceAvailabilityRateLimit,
} from "@/lib/availability-rate-limit";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/availability/monthly";

  const month = request.nextUrl.searchParams.get("month");
  if (!month) {
    return apiError(400, {
      error: "month is required",
      code: "MISSING_MONTH",
      requestId,
    });
  }

  const parsedMonth = monthStringSchema.safeParse(month);
  if (!parsedMonth.success) {
    return apiError(400, {
      error: "month must be YYYY-MM format",
      code: "INVALID_MONTH",
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

  const [year, monthNum] = month.split("-").map((v) => Number(v));
  if (!year || !monthNum || monthNum < 1 || monthNum > 12) {
    return apiError(400, {
      error: "month must be valid YYYY-MM",
      code: "INVALID_MONTH",
      requestId,
    });
  }

  try {
    let allowed: boolean;
    try {
      allowed = await enforceAvailabilityRateLimit(request);
    } catch (error) {
      logError("availability.monthly.rate_limit.failed", {
        requestId,
        route,
        errorCode: "RATE_LIMIT_CHECK_FAILED",
        context: { message: error instanceof Error ? error.message : String(error) },
      });
      return apiError(503, {
        error: "Availability is temporarily unavailable",
        code: "RATE_LIMIT_CHECK_FAILED",
        requestId,
      });
    }
    if (!allowed) {
      return apiError(
        429,
        { error: "Too many availability requests", code: "RATE_LIMITED", requestId },
        { headers: { "Retry-After": String(AVAILABILITY_RATE_LIMIT_WINDOW_SECONDS) } },
      );
    }

    await ensureReservationSchemaReady(prisma);
    const result = await getMonthlyAvailability(
      {
        month,
        servicePeriod: parsedServicePeriod.data,
        partySize,
      },
      prisma
    );

    return NextResponse.json(
      {
        month,
        days: result,
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    logError("availability.monthly.fetch.failed", {
      requestId,
      route,
      errorCode: "AVAILABILITY_MONTHLY_FETCH_FAILED",
      context: {
        month,
        servicePeriod,
        partySize,
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return apiError(500, {
      error: "Failed to fetch monthly availability",
      code: "AVAILABILITY_MONTHLY_FETCH_FAILED",
      requestId,
    });
  }
}
