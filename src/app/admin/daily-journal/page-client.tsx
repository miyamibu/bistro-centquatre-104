"use client";

import Link from "next/link";
import {
  CalendarDays,
  Eye,
  ImagePlus,
  PenLine,
  Plus,
  Save,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DAILY_JOURNAL_CATEGORIES,
  DAILY_JOURNAL_SEED_ENTRIES,
  formatJournalDate,
  getTodayDateInputValue,
  normalizePhotoUrl,
  sortDailyJournalEntries,
  type DailyJournalCategory,
  type DailyJournalEntry,
  type DailyJournalStatus,
} from "@/lib/daily-journal";

type EditorMode = "編集" | "プレビュー";

type FormState = {
  id: string | null;
  date: string;
  title: string;
  category: DailyJournalCategory;
  body: string;
  photoUrl: string;
  status: DailyJournalStatus;
};

const emptyForm = (): FormState => ({
  id: null,
  date: getTodayDateInputValue(),
  title: "",
  category: "料理",
  body: "",
  photoUrl: "",
  status: "draft",
});

function toFormState(entry: DailyJournalEntry): FormState {
  return {
    id: entry.id,
    date: entry.date,
    title: entry.title,
    category: entry.category,
    body: entry.body,
    photoUrl: entry.photoUrl,
    status: entry.status,
  };
}

function buildEntry(form: FormState, status: DailyJournalStatus): DailyJournalEntry {
  return {
    id: form.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    date: form.date,
    title: form.title.trim() || "今日の出来事",
    category: form.category,
    body: form.body.trim() || "本文を入力してください。",
    photoUrl: normalizePhotoUrl(form.photoUrl),
    status,
    updatedAt: new Date().toISOString(),
  };
}

function statusLabel(status: DailyJournalStatus) {
  return status === "published" ? "公開中" : "下書き";
}

export function AdminDailyJournalClient() {
  const [entries, setEntries] = useState<DailyJournalEntry[]>([]);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [mode, setMode] = useState<EditorMode>("編集");
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchEntries() {
      try {
        const response = await fetch("/api/admin/daily-journal", {
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
        setMessage("記事の読み込みに失敗しました。");
      }
    }

    void fetchEntries();
    return () => controller.abort();
  }, []);

  const sortedEntries = useMemo(() => sortDailyJournalEntries(entries), [entries]);
  const previewEntry = buildEntry(form, form.status);
  const canSave = form.title.trim().length > 0 || form.body.trim().length > 0;

  async function save(status: DailyJournalStatus) {
    if (!canSave) {
      setMessage("タイトルまたは本文を入力してください。");
      return;
    }

    const entry = buildEntry(form, status);
    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/daily-journal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({ ...entry, id: form.id }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to save daily journal entry");
      }

      const payload = (await response.json()) as { entry: DailyJournalEntry };
      const savedEntry = payload.entry;
      const withoutCurrent = entries.filter((item) => item.id !== savedEntry.id);
      const nextEntries = sortDailyJournalEntries([savedEntry, ...withoutCurrent]);

      setEntries(nextEntries);
      setForm(toFormState(savedEntry));
      setMessage(status === "published" ? "記事を公開しました。" : "下書きを保存しました。");
    } catch {
      setMessage("保存に失敗しました。時間をおいてもう一度お試しください。");
    } finally {
      setIsSaving(false);
    }
  }

  function startNew() {
    setForm(emptyForm());
    setMode("編集");
    setMessage("");
  }

  function selectEntry(entry: DailyJournalEntry) {
    setForm(toFormState(entry));
    setMode("編集");
    setMessage("");
  }

  function loadSeed() {
    setForm({ ...toFormState(DAILY_JOURNAL_SEED_ENTRIES[0]), id: null });
    setMessage("サンプル内容を入力しました。必要に応じて編集して保存してください。");
  }

  async function handlePhotoFile(file: File | undefined) {
    if (!file) return;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("写真の読み込みに失敗しました。"));
      reader.readAsDataURL(file);
    }).catch(() => "");

    if (dataUrl) {
      setForm((current) => ({ ...current, photoUrl: dataUrl }));
    }
  }

  return (
    <section className="min-h-screen bg-white pb-12 pt-8 text-[#2f1b0f]">
      <div className="mx-auto max-w-7xl space-y-6 px-4">
        <header className="flex flex-col gap-4 border-b border-[#eadfce] pb-5 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="text-sm text-[#6b5644]">お店側 管理画面</p>
            <h1 className="text-2xl font-semibold md:text-3xl">日々の出来事を書く</h1>
            <p className="text-sm leading-7 text-[#6b5644]">
              スタッフのみ編集できます。公開した記事だけがお客さま向けページに表示されます。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <Link
              href="/daily-journal"
              className="inline-flex h-10 items-center justify-center rounded-full border border-[#cfa96d]/45 bg-white px-4 text-sm font-semibold text-[#4a3121] transition hover:border-[#8a6233] hover:bg-[#fffdfa]"
            >
              公開ページを見る
            </Link>
            <button
              type="button"
              onClick={startNew}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#2f1b0f] px-4 text-sm font-semibold text-white transition hover:bg-[#4a3121]"
            >
              <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
              新規作成
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-5 rounded-2xl border border-[#cfa96d]/35 bg-[#fffdfa] p-5 shadow-sm md:p-6">
            <div className="flex flex-col gap-3 border-b border-[#eadfce] pb-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <PenLine size={20} strokeWidth={1.8} className="text-[#8a6233]" aria-hidden="true" />
                <h2 className="text-lg font-semibold">出来事を書く</h2>
              </div>
              <div className="inline-flex rounded-full border border-[#cfa96d]/40 bg-white p-1">
                {(["編集", "プレビュー"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    className={`h-8 rounded-full px-4 text-sm transition ${
                      mode === item ? "bg-[#8a6233] text-white" : "text-[#4a3121] hover:bg-[#f8f1e7]"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {mode === "編集" ? (
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save("published");
                }}
              >
                <label className="block space-y-2 text-sm font-medium text-[#4a3121]">
                  <span>公開日</span>
                  <span className="relative block">
                    <CalendarDays
                      size={18}
                      strokeWidth={1.8}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a6233]"
                      aria-hidden="true"
                    />
                    <input
                      type="date"
                      value={form.date}
                      onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                      className="w-full rounded-lg border border-[#cfa96d]/45 bg-white px-10 py-3 text-[#2f1b0f] outline-none transition focus:border-[#8a6233] focus:ring-2 focus:ring-[#cfa96d]/25"
                    />
                  </span>
                </label>

                <label className="block space-y-2 text-sm font-medium text-[#4a3121]">
                  <span>タイトル</span>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="例：季節の前菜を仕込みました"
                    className="w-full rounded-lg border border-[#cfa96d]/45 bg-white px-4 py-3 text-[#2f1b0f] outline-none transition placeholder:text-[#9a8a78] focus:border-[#8a6233] focus:ring-2 focus:ring-[#cfa96d]/25"
                  />
                </label>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-[#4a3121]">分類</legend>
                  <div className="flex flex-wrap gap-2">
                    {DAILY_JOURNAL_CATEGORIES.map((item) => (
                      <label
                        key={item}
                        className={`cursor-pointer rounded-full border px-3 py-2 text-sm transition ${
                          form.category === item
                            ? "border-[#8a6233] bg-[#8a6233] text-white"
                            : "border-[#cfa96d]/45 bg-white text-[#4a3121] hover:border-[#8a6233]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="category"
                          value={item}
                          checked={form.category === item}
                          onChange={() => setForm((current) => ({ ...current, category: item }))}
                          className="sr-only"
                        />
                        {item}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="block space-y-2 text-sm font-medium text-[#4a3121]">
                  <span>本文</span>
                  <textarea
                    value={form.body}
                    onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                    placeholder="今日の出来事、仕込み、料理、店内の変化などを書いてください。"
                    rows={9}
                    className="w-full resize-y rounded-lg border border-[#cfa96d]/45 bg-white px-4 py-3 leading-7 text-[#2f1b0f] outline-none transition placeholder:text-[#9a8a78] focus:border-[#8a6233] focus:ring-2 focus:ring-[#cfa96d]/25"
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                  <label className="block space-y-2 text-sm font-medium text-[#4a3121]">
                    <span>写真URL</span>
                    <input
                      type="text"
                      value={form.photoUrl.startsWith("data:image/") ? "アップロード済みの写真" : form.photoUrl}
                      onChange={(event) => setForm((current) => ({ ...current, photoUrl: event.target.value }))}
                      placeholder="/photos/料理/料理１.JPG"
                      className="w-full rounded-lg border border-[#cfa96d]/45 bg-white px-4 py-3 text-[#2f1b0f] outline-none transition placeholder:text-[#9a8a78] focus:border-[#8a6233] focus:ring-2 focus:ring-[#cfa96d]/25"
                    />
                  </label>
                  <label className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#cfa96d]/45 bg-white px-4 text-sm font-semibold text-[#4a3121] transition hover:border-[#8a6233] hover:bg-[#f8f1e7]">
                    <ImagePlus size={18} strokeWidth={1.8} aria-hidden="true" />
                    写真を選ぶ
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(event) => void handlePhotoFile(event.target.files?.[0])}
                    />
                  </label>
                </div>

                <label className="block space-y-2 text-sm font-medium text-[#4a3121]">
                  <span>公開状態</span>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, status: event.target.value as DailyJournalStatus }))
                    }
                    className="w-full rounded-lg border border-[#cfa96d]/45 bg-white px-4 py-3 text-[#2f1b0f] outline-none transition focus:border-[#8a6233] focus:ring-2 focus:ring-[#cfa96d]/25"
                  >
                    <option value="draft">下書き</option>
                    <option value="published">公開中</option>
                  </select>
                </label>

                <div className="flex flex-col gap-3 border-t border-[#eadfce] pt-4 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => void save("draft")}
                    disabled={isSaving}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#cfa96d]/45 bg-white px-4 text-sm font-semibold text-[#4a3121] transition hover:border-[#8a6233] hover:bg-[#f8f1e7]"
                  >
                    <Save size={18} strokeWidth={1.8} aria-hidden="true" />
                    {isSaving ? "保存中" : "下書き保存"}
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#4d4b2d] px-4 text-sm font-semibold text-white transition hover:bg-[#33321e]"
                  >
                    <Send size={18} strokeWidth={1.8} aria-hidden="true" />
                    {isSaving ? "保存中" : "公開する"}
                  </button>
                  {message ? <p className="text-sm text-[#6b5644]">{message}</p> : null}
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-[#8a6233]">
                  <Eye size={18} strokeWidth={1.8} aria-hidden="true" />
                  公開プレビュー
                </p>
                <PreviewCard entry={previewEntry} />
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <div className="rounded-2xl border border-[#cfa96d]/35 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-[#eadfce] pb-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8a6233]">Preview</p>
                  <h2 className="mt-1 text-xl font-semibold">公開プレビュー</h2>
                </div>
                <span className="rounded-full border border-[#cfa96d]/40 px-3 py-1 text-xs text-[#8a6233]">
                  {statusLabel(form.status)}
                </span>
              </div>
              <div className="mt-4">
                <PreviewCard entry={previewEntry} compact />
              </div>
            </div>

            <div className="rounded-2xl border border-[#cfa96d]/35 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-[#eadfce] pb-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8a6233]">Recent</p>
                  <h2 className="mt-1 text-xl font-semibold">最近の記事</h2>
                </div>
                <button
                  type="button"
                  onClick={loadSeed}
                  className="text-xs font-semibold text-[#8a6233] underline underline-offset-2"
                >
                  サンプル入力
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {sortedEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => selectEntry(entry)}
                    className="w-full rounded-xl border border-[#eadfce] bg-[#fffdfa] p-3 text-left transition hover:border-[#cfa96d] hover:bg-[#f8f1e7]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-[#6b5644]">{formatJournalDate(entry.date)}</span>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${
                          entry.status === "published"
                            ? "bg-[#f3eadc] text-[#8a6233]"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {statusLabel(entry.status)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-semibold text-[#2f1b0f]">{entry.title}</p>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

function PreviewCard({ entry, compact = false }: { entry: DailyJournalEntry; compact?: boolean }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-[#cfa96d]/30 bg-white text-[#4a3121] shadow-sm">
      <div
        className={`bg-[#f7efe4] bg-cover bg-center ${compact ? "h-44" : "h-64"}`}
        style={{
          backgroundImage: entry.photoUrl
            ? `url("${entry.photoUrl}")`
            : "linear-gradient(135deg, rgba(207,169,109,0.26), rgba(255,253,250,0.9))",
        }}
      />
      <div className={compact ? "space-y-3 p-4" : "space-y-4 p-5"}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#6b5644]">
          <span>{formatJournalDate(entry.date)}</span>
          <span className="rounded-full border border-[#cfa96d]/40 bg-[#fffdfa] px-2.5 py-1 text-[#8a6233]">
            {entry.category}
          </span>
        </div>
        <h3 className={compact ? "text-lg font-semibold text-[#2f1b0f]" : "text-2xl font-semibold text-[#2f1b0f]"}>
          {entry.title}
        </h3>
        <p className="whitespace-pre-wrap text-sm leading-7">{entry.body}</p>
      </div>
    </article>
  );
}
