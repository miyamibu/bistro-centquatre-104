import { NextResponse } from "next/server";
import { DailyJournalStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DAILY_JOURNAL_SEED_ENTRIES } from "@/lib/daily-journal";
import { toDailyJournalEntry } from "@/lib/daily-journal/server";
import { getRequestId, logError, logWarn } from "@/lib/logger";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function isDailyJournalTableMissing(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const entries = await prisma.dailyJournalEntry.findMany({
      where: { status: DailyJournalStatus.PUBLISHED },
      orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
    });

    return NextResponse.json({ entries: entries.map(toDailyJournalEntry), source: "database" });
  } catch (error) {
    if (isDailyJournalTableMissing(error)) {
      logWarn("daily_journal.table_missing", {
        requestId,
        route: "/api/daily-journal",
        errorCode: "DAILY_JOURNAL_TABLE_MISSING",
      });
      return NextResponse.json({ entries: DAILY_JOURNAL_SEED_ENTRIES, source: "seed" });
    }

    logError("daily_journal.fetch.failed", {
      requestId,
      route: "/api/daily-journal",
      errorCode: "DAILY_JOURNAL_FETCH_FAILED",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json(
      { error: "Failed to fetch daily journal entries", code: "DAILY_JOURNAL_FETCH_FAILED", requestId },
      { status: 500 },
    );
  }
}
