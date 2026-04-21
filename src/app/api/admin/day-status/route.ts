import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/basic-auth";
import { getAdminDayStatus, getAdminMonthStatus } from "@/lib/admin-day-status";
import { apiError } from "@/lib/api-security";
import { getRequestId, logError } from "@/lib/logger";
import { isReservationSchemaNotReadyError, RESERVATION_SCHEMA_NOT_READY_CODE } from "@/lib/reservation-compat";
import { dateStringSchema, monthStringSchema, zodFields } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/admin/day-status";

  if (!isAuthorized(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const date = request.nextUrl.searchParams.get("date");
  const month = request.nextUrl.searchParams.get("month");

  if ((date && month) || (!date && !month)) {
    return apiError(400, {
      error: "`date` か `month` のどちらか一方を指定してください",
      code: "INVALID_QUERY",
      requestId,
    });
  }

  if (date) {
    const parsedDate = dateStringSchema.safeParse(date);
    if (!parsedDate.success) {
      return apiError(400, {
        error: "入力内容が不正です",
        code: "VALIDATION_ERROR",
        fields: zodFields(parsedDate.error),
        requestId,
      });
    }

    try {
      const dayStatus = await getAdminDayStatus(parsedDate.data);
      return NextResponse.json(dayStatus);
    } catch (error) {
      if (isReservationSchemaNotReadyError(error)) {
        return apiError(503, {
          error: "Reservation schema is not ready",
          code: RESERVATION_SCHEMA_NOT_READY_CODE,
          requestId,
        });
      }

      logError("admin.day_status.fetch.failed", {
        requestId,
        route,
        errorCode: "ADMIN_DAY_STATUS_FETCH_FAILED",
        context: { date, message: error instanceof Error ? error.message : String(error) },
      });
      return apiError(500, {
        error: "Failed to fetch day status",
        code: "ADMIN_DAY_STATUS_FETCH_FAILED",
        requestId,
      });
    }
  }

  const parsedMonth = monthStringSchema.safeParse(month);
  if (!parsedMonth.success) {
    return apiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      fields: zodFields(parsedMonth.error),
      requestId,
    });
  }

  try {
    const monthStatus = await getAdminMonthStatus(parsedMonth.data);
    return NextResponse.json(monthStatus);
  } catch (error) {
    if (isReservationSchemaNotReadyError(error)) {
      return apiError(503, {
        error: "Reservation schema is not ready",
        code: RESERVATION_SCHEMA_NOT_READY_CODE,
        requestId,
      });
    }

    if (error instanceof Error && error.message === "INVALID_MONTH") {
      return apiError(400, {
        error: "month must be valid YYYY-MM",
        code: "INVALID_MONTH",
        requestId,
      });
    }

    logError("admin.month_status.fetch.failed", {
      requestId,
      route,
      errorCode: "ADMIN_MONTH_STATUS_FETCH_FAILED",
      context: { month, message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to fetch month status",
      code: "ADMIN_MONTH_STATUS_FETCH_FAILED",
      requestId,
    });
  }
}
