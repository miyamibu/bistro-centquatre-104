import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorized } from "@/lib/basic-auth";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { upsertBusinessDaySchema, zodFields } from "@/lib/validation";
import { getRequestId, logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  if (!isAuthorized(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  try {
    const date = request.nextUrl.searchParams.get("date");
    if (date) {
      const day = await prisma.businessDay.findUnique({ where: { date } });
      return NextResponse.json(day ?? { date, isClosed: false });
    }
    const days = await prisma.businessDay.findMany({ orderBy: { date: "asc" } });
    return NextResponse.json(days);
  } catch (error) {
    logError("admin.business_days.fetch.failed", {
      requestId,
      route: "/api/admin/business-days",
      errorCode: "BUSINESS_DAYS_FETCH_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to fetch business days",
      code: "BUSINESS_DAYS_FETCH_FAILED",
      requestId,
    });
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  if (!isAuthorized(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const securityError = enforceWriteRequestSecurity(request, { requestId });
  if (securityError) return securityError;

  try {
    const body = await request.json().catch(() => null);
    const parsed = upsertBusinessDaySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, {
        error: "入力内容が不正です",
        code: "VALIDATION_ERROR",
        fields: zodFields(parsed.error),
        requestId,
      });
    }

    const { date, isClosed, note } = parsed.data;
    const saved = await prisma.businessDay.upsert({
      where: { date },
      update: { isClosed: !!isClosed, note: note ?? null },
      create: { date, isClosed: !!isClosed, note: note ?? null },
    });

    return NextResponse.json(saved);
  } catch (error) {
    logError("admin.business_days.save.failed", {
      requestId,
      route: "/api/admin/business-days",
      errorCode: "BUSINESS_DAYS_SAVE_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to save business day",
      code: "BUSINESS_DAYS_SAVE_FAILED",
      requestId,
    });
  }
}
