import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/basic-auth";
import { supabaseServer } from "@/lib/supabase-server";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { getRequestId, logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

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

  if (!isAuthorized(request)) {
    return unauthorized(requestId);
  }

  try {
    const { data, error } = await supabaseServer
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

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

  if (!isAuthorized(request)) {
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

  if (!isAuthorized(request)) {
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
