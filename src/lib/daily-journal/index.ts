export type DailyJournalCategory = "料理" | "仕込み" | "店内" | "お知らせ";

export type DailyJournalStatus = "published" | "draft";

export type DailyJournalEntry = {
  id: string;
  date: string;
  title: string;
  category: DailyJournalCategory;
  body: string;
  photoUrl: string;
  status: DailyJournalStatus;
  updatedAt: string;
};

export const DAILY_JOURNAL_CATEGORIES: DailyJournalCategory[] = [
  "料理",
  "仕込み",
  "店内",
  "お知らせ",
];

export const DAILY_JOURNAL_SEED_ENTRIES: DailyJournalEntry[] = [
  {
    id: "seed-2026-05-05",
    date: "2026-05-05",
    title: "季節の前菜を仕込みました",
    category: "仕込み",
    body: "春野菜の香りを確かめながら、明日のコースに向けて前菜の準備を進めました。少しずつ初夏の食材も入ってきています。",
    photoUrl: "/photos/料理/料理１.JPG",
    status: "published",
    updatedAt: "2026-05-05T09:00:00.000Z",
  },
  {
    id: "seed-2026-05-04",
    date: "2026-05-04",
    title: "店内の花を入れ替えました",
    category: "店内",
    body: "入口まわりに明るい色の花を少し。ご来店の前後に、季節の空気も一緒に感じていただけたら嬉しいです。",
    photoUrl: "/photos/内装/内装1.JPG",
    status: "published",
    updatedAt: "2026-05-04T09:00:00.000Z",
  },
  {
    id: "seed-2026-05-03",
    date: "2026-05-03",
    title: "魚料理のソースを調整中です",
    category: "料理",
    body: "ランチとディナーで少し印象が変わるように、魚料理のソースを細かく調整しています。",
    photoUrl: "/photos/料理/料理３.JPG",
    status: "published",
    updatedAt: "2026-05-03T09:00:00.000Z",
  },
];

export function getTodayDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function formatJournalDate(value: string) {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export function sortDailyJournalEntries(entries: DailyJournalEntry[]) {
  return [...entries].sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);

    if (dateCompare !== 0) {
      return dateCompare;
    }

    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function normalizePhotoUrl(value: string) {
  const trimmed = value.trim();
  const isDataImage = trimmed.startsWith("data:image/");
  const hasImageExtension = /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(trimmed);

  if (
    isDataImage ||
    (hasImageExtension &&
      (trimmed.startsWith("/") || trimmed.startsWith("https://") || trimmed.startsWith("http://")))
  ) {
    return trimmed.replaceAll('"', "%22");
  }

  return "";
}
