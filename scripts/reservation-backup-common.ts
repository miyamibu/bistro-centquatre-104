import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_LOOKBACK_DAYS = 30;
export const DEFAULT_LOOKAHEAD_DAYS = 60;
export const DEFAULT_CHUNK_DAYS = 30;
export const DEFAULT_RETENTION_DAYS = 30;
export const MIN_RETENTION_DAYS = 30;
export const MAX_EXPORT_RANGE_DAYS = 31;

export function parseEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  const output: Record<string, string> = {};
  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    value = value.replace(/\s+#.*$/, "").trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      output[key] = value;
    }
  }

  return output;
}

export function loadMergedEnv(cwd: string) {
  const merged = {
    ...parseEnvFile(path.join(cwd, ".env")),
    ...parseEnvFile(path.join(cwd, ".env.local")),
  };

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value.trim() !== "") {
      merged[key] = value.trim();
    }
  }

  return merged;
}

export function parseCliArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const normalized = token.slice(2);
    const eqIndex = normalized.indexOf("=");
    if (eqIndex >= 0) {
      const key = normalized.slice(0, eqIndex);
      const value = normalized.slice(eqIndex + 1);
      args.set(key, value);
      continue;
    }

    const nextToken = argv[index + 1];
    if (!nextToken || nextToken.startsWith("--")) {
      args.set(normalized, "true");
      continue;
    }

    args.set(normalized, nextToken);
    index += 1;
  }

  return args;
}

export function readOption(args: Map<string, string>, key: string) {
  return args.get(key);
}

export function parsePositiveInt(input: string | undefined, fallback: number, optionName: string) {
  if (!input) return fallback;

  const value = Number(input);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${optionName} は 1 以上の整数を指定してください`);
  }
  return value;
}

export function parseDateStrict(value: string, optionName: string) {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`${optionName} は YYYY-MM-DD 形式で指定してください`);
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${optionName} は実在する日付を指定してください`);
  }

  return parsed;
}

export function formatDateUtc(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysUtc(value: Date, amount: number) {
  const copy = new Date(value.getTime());
  copy.setUTCDate(copy.getUTCDate() + amount);
  return copy;
}

export function enumerateDateStrings(from: string, to: string) {
  const start = parseDateStrict(from, "`from`");
  const end = parseDateStrict(to, "`to`");
  if (start.getTime() > end.getTime()) {
    throw new Error("`from` は `to` 以下の日付にしてください");
  }

  const output: string[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    output.push(formatDateUtc(cursor));
    cursor = addDaysUtc(cursor, 1);
  }
  return output;
}

export function getTodayJstDateString(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const formatted = formatter.format(now);
  if (!DATE_PATTERN.test(formatted)) {
    throw new Error(`JST日付の取得に失敗しました: ${formatted}`);
  }
  return formatted;
}

export function createTimestampLabel(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

export function getDefaultBackupOutputDir() {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "bistro-reservation",
      "backups",
      "reservation-status"
    );
  }

  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "bistro-reservation", "backups", "reservation-status");
  }

  const dataHome =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "bistro-reservation", "backups", "reservation-status");
}

export function resolveOutputDir(cwd: string, rawValue: string | undefined) {
  if (!rawValue) {
    return getDefaultBackupOutputDir();
  }
  return path.isAbsolute(rawValue) ? rawValue : path.join(cwd, rawValue);
}

export function normalizeBaseUrl(raw: string) {
  const url = new URL(raw);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}
