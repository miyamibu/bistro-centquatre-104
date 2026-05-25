import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorized } from "@/lib/basic-auth";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { dailyJournalPayloadSchema, toDailyJournalCreateUpdate, toDailyJournalEntry } from "@/lib/daily-journal/server";
import { getRequestId, logError } from "@/lib/logger";
import { zodFields } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  if (!isAuthorized(request)) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  try {
    const entries = await prisma.dailyJournalEntry.findMany({
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
    });

    return NextResponse.json({ entries: entries.map(toDailyJournalEntry) });
  } catch (error) {
    logError("admin.daily_journal.fetch.failed", {
      requestId,
      route: "/api/admin/daily-journal",
      errorCode: "ADMIN_DAILY_JOURNAL_FETCH_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to fetch daily journal entries",
      code: "ADMIN_DAILY_JOURNAL_FETCH_FAILED",
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
    const parsed = dailyJournalPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(400, {
        error: "入力内容が不正です",
        code: "VALIDATION_ERROR",
        fields: zodFields(parsed.error),
        requestId,
      });
    }

    const data = toDailyJournalCreateUpdate(parsed.data);
    const saved = parsed.data.id
      ? await prisma.dailyJournalEntry.update({
          where: { id: parsed.data.id },
          data,
        })
      : await prisma.dailyJournalEntry.create({ data });

    return NextResponse.json({ entry: toDailyJournalEntry(saved) });
  } catch (error) {
    logError("admin.daily_journal.save.failed", {
      requestId,
      route: "/api/admin/daily-journal",
      errorCode: "ADMIN_DAILY_JOURNAL_SAVE_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return apiError(500, {
      error: "Failed to save daily journal entry",
      code: "ADMIN_DAILY_JOURNAL_SAVE_FAILED",
      requestId,
    });
  }
}
