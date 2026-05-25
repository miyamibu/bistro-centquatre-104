"use client";

import { CalendarDays, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DAILY_JOURNAL_CATEGORIES,
  DAILY_JOURNAL_SEED_ENTRIES,
  formatJournalDate,
  sortDailyJournalEntries,
  type DailyJournalCategory,
  type DailyJournalEntry,
} from "@/lib/daily-journal";

type FilterKey = "すべて" | DailyJournalCategory;

const FILTERS: FilterKey[] = ["すべて", ...DAILY_JOURNAL_CATEGORIES];

function JournalPhoto({ entry, className = "" }: { entry: DailyJournalEntry; className?: string }) {
  return (
    <div
      className={`bg-[#f7efe4] bg-cover bg-center ${className}`}
      style={{
        backgroundImage: entry.photoUrl
          ? `url("${entry.photoUrl}")`
          : "linear-gradient(135deg, rgba(207,169,109,0.26), rgba(255,253,250,0.9))",
      }}
      aria-label={`${entry.title}の写真`}
    />
  );
}

function EntryMeta({ entry }: { entry: DailyJournalEntry }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[#6b5644]">
      <span className="inline-flex items-center gap-1.5">
        <CalendarDays size={14} strokeWidth={1.8} aria-hidden="true" />
        {formatJournalDate(entry.date)}
      </span>
      <span className="rounded-full border border-[#cfa96d]/40 bg-[#fffdfa] px-2.5 py-1 text-[#8a6233]">
        {entry.category}
      </span>
    </div>
  );
}

export function DailyJournalPageClient() {
  const [entries, setEntries] = useState<DailyJournalEntry[]>(DAILY_JOURNAL_SEED_ENTRIES);
  const [filter, setFilter] = useState<FilterKey>("すべて");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchEntries() {
      try {
        const response = await fetch("/api/daily-journal", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to fetch daily journal entries");
        }

        const payload = (await response.json()) as { entries?: DailyJournalEntry[] };
        setEntries(Array.isArray(payload.entries) ? payload.entries : []);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void fetchEntries();
    return () => controller.abort();
  }, []);

  const publishedEntries = useMemo(
    () =>
      sortDailyJournalEntries(entries).filter(
        (entry) => entry.status === "published" && (filter === "すべて" || entry.category === filter),
      ),
    [entries, filter],
  );

  const latestEntry = publishedEntries[0] ?? null;
  const olderEntries = publishedEntries.slice(1);

  return (
    <section className="pb-16 pt-[36px] text-[#2f1b0f] md:pb-24 md:pt-[112px]">
      <div className="mx-auto max-w-5xl space-y-9">
        <header className="grid gap-6 md:items-end">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8a6233]">Daily Journal</p>
            <h1 className="text-3xl font-semibold leading-tight md:text-4xl">日々の出来事</h1>
            <p className="max-w-2xl text-sm leading-7 text-[#4a3121] md:text-base">
              仕込み、料理、季節のこと。お店の日々を少しずつお届けします。
            </p>
          </div>
        </header>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`h-10 shrink-0 rounded-full border px-4 text-sm transition ${
                filter === item
                  ? "border-[#8a6233] bg-[#8a6233] text-white"
                  : "border-[#cfa96d]/45 bg-white text-[#4a3121] hover:border-[#8a6233]"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        {latestEntry ? (
          <article className="grid overflow-hidden rounded-2xl border border-[#cfa96d]/35 bg-white shadow-sm md:grid-cols-[1.08fr_0.92fr]">
            <JournalPhoto entry={latestEntry} className="min-h-[260px] md:min-h-[390px]" />
            <div className="flex flex-col justify-center gap-4 p-5 md:p-8">
              <EntryMeta entry={latestEntry} />
              <div className="space-y-3">
                <h2 className="text-2xl font-semibold leading-snug md:text-3xl">{latestEntry.title}</h2>
                <p className="text-sm leading-7 text-[#4a3121] md:text-base">{latestEntry.body}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#8a6233]">
                最新の記事
                <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
              </span>
            </div>
          </article>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#cfa96d]/45 bg-[#fffdfa] p-8 text-center text-sm leading-7 text-[#6b5644]">
            {isLoading ? "読み込み中です。" : "まだ公開中の記事はありません。"}
          </div>
        )}

        {olderEntries.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-4 border-b border-[#eadfce] pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8a6233]">Archive</p>
                <h2 className="mt-1 text-2xl font-semibold">これまでの記録</h2>
              </div>
              <p className="shrink-0 text-sm text-[#6b5644]">{olderEntries.length}件</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {olderEntries.map((entry) => (
                <article
                  key={entry.id}
                  className="grid gap-4 rounded-2xl border border-[#cfa96d]/30 bg-white p-4 text-[#4a3121] shadow-sm sm:grid-cols-[9rem_1fr]"
                >
                  <JournalPhoto entry={entry} className="min-h-36 rounded-xl" />
                  <div className="min-w-0 space-y-3">
                    <EntryMeta entry={entry} />
                    <h3 className="text-lg font-semibold leading-snug text-[#2f1b0f]">{entry.title}</h3>
                    <p className="line-clamp-3 text-sm leading-7">{entry.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
