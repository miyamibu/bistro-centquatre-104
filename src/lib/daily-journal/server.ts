import { DailyJournalStatus as PrismaDailyJournalStatus, type DailyJournalEntry as PrismaDailyJournalEntry } from "@prisma/client";
import { z } from "zod";
import { dateStringSchema } from "@/lib/validation";
import {
  DAILY_JOURNAL_CATEGORIES,
  normalizePhotoUrl,
  type DailyJournalEntry,
  type DailyJournalStatus,
} from "@/lib/daily-journal";

export const dailyJournalPayloadSchema = z.object({
  id: z.string().min(1).optional().nullable(),
  date: dateStringSchema,
  title: z.string().trim().min(1, "タイトルを入力してください").max(80, "タイトルは80文字以内で入力してください"),
  category: z.enum(DAILY_JOURNAL_CATEGORIES as [string, ...string[]]),
  body: z.string().trim().min(1, "本文を入力してください").max(3000, "本文は3000文字以内で入力してください"),
  photoUrl: z.string().max(2_000_000, "写真データが大きすぎます").optional().default(""),
  status: z.enum(["published", "draft"]),
});

export type DailyJournalPayload = z.infer<typeof dailyJournalPayloadSchema>;

function toPrismaStatus(status: DailyJournalStatus): PrismaDailyJournalStatus {
  return status === "published" ? PrismaDailyJournalStatus.PUBLISHED : PrismaDailyJournalStatus.DRAFT;
}

export function toDailyJournalEntry(entry: PrismaDailyJournalEntry): DailyJournalEntry {
  return {
    id: entry.id,
    date: entry.date,
    title: entry.title,
    category: DAILY_JOURNAL_CATEGORIES.includes(entry.category as DailyJournalEntry["category"])
      ? (entry.category as DailyJournalEntry["category"])
      : "お知らせ",
    body: entry.body,
    photoUrl: entry.photoUrl ?? "",
    status: entry.status === PrismaDailyJournalStatus.PUBLISHED ? "published" : "draft",
    updatedAt: entry.updatedAt.toISOString(),
  };
}

export function toDailyJournalCreateUpdate(payload: DailyJournalPayload) {
  return {
    date: payload.date,
    title: payload.title.trim(),
    category: payload.category,
    body: payload.body.trim(),
    photoUrl: normalizePhotoUrl(payload.photoUrl ?? "") || null,
    status: toPrismaStatus(payload.status),
  };
}
