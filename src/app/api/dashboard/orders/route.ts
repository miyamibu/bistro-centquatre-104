import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getStaffAuth } from "@/lib/staff-auth";
import { supabaseServer } from "@/lib/supabase-server";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { getRequestId, logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
const ORDER_LIST_LIMIT = 100;

function unauthorized(requestId: string) {
  return apiError(401, {
    error: "Unauthorized",
    code: "UNAUTHORIZED",
    requestId,
  });
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const route = "/api/dashboard/orders";

  if (!(await getStaffAuth())) {
    return unauthorized(requestId);
  }

  try {
    const { data, error } = await supabaseServer
      .from("orders")
      .select(
        "id, customer_name, email, phone, zip_code, prefecture, city, address, building, payment_method, items, total, store_visit_date, status, version, created_at"
      )
      .order("created_at", { ascending: false })
      .range(0, ORDER_LIST_LIMIT - 1);

    if (error) throw error;

    return NextResponse.json(data || []);
  } catch (error) {
    logError("dashboard.orders.fetch.failed", {
      requestId,
      route,
      errorCode: "DASHBOARD_ORDER_FETCH_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to fetch orders",
      code: "DASHBOARD_ORDER_FETCH_FAILED",
      requestId,
    });
  }
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request);

  if (!(await getStaffAuth())) {
    return unauthorized(requestId);
  }

  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  return apiError(410, {
    error: "Direct status updates are disabled. Use /api/orders/{id}/actions",
    code: "DIRECT_STATUS_UPDATE_DISABLED",
    requestId,
  });
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request);

  if (!(await getStaffAuth())) {
    return unauthorized(requestId);
  }

  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  return apiError(410, {
    error: "Direct delete/archive is disabled. Use /api/orders/{id}/actions",
    code: "DIRECT_ORDER_DELETE_DISABLED",
    requestId,
  });
}
