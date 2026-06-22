import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { z } from "zod";
import {
  DATE_PATTERN,
  DEFAULT_CHUNK_DAYS,
  DEFAULT_LOOKAHEAD_DAYS,
  DEFAULT_LOOKBACK_DAYS,
  MAX_EXPORT_RANGE_DAYS,
  addDaysUtc,
  createTimestampLabel,
  enumerateDateStrings,
  formatDateUtc,
  getTodayJstDateString,
  loadMergedEnv,
  normalizeBaseUrl,
  parseCliArgs,
  parseDateStrict,
  parsePositiveInt,
  readOption,
  resolveOutputDir,
} from "./reservation-backup-common";

const DEFAULT_ROUTE_PATH = "/api/admin/backups/reservations/export";

const dateStringSchema = z.string().regex(DATE_PATTERN);
const businessDaySchema = z.object({
  id: z.string(),
  date: dateStringSchema,
  isClosed: z.boolean(),
  note: z.string().nullable(),
});
const reservationSchema = z.object({
  id: z.string(),
  date: dateStringSchema,
  servicePeriod: z.enum(["LUNCH", "DINNER"]),
  reservationType: z.enum(["NORMAL", "PRIVATE_BLOCK"]),
  seatType: z.enum(["MAIN", "ROOM1", "ROOM2"]),
  partySize: z.number().int().positive(),
  arrivalTime: z.string().nullable(),
  name: z.string(),
  phone: z.string(),
  note: z.string().nullable(),
  status: z.enum(["CONFIRMED", "CANCELLED", "DONE", "NOSHOW"]),
  lineUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const privateBlockAuditLogSchema = z.object({
  id: z.string(),
  reservationId: z.string().nullable(),
  date: dateStringSchema,
  servicePeriod: z.enum(["LUNCH", "DINNER"]),
  result: z.enum(["CREATED", "NO_OP", "RELEASED"]),
  source: z.enum(["PUBLIC_FORM", "ADMIN_SHARED_BASIC"]),
  actorName: z.string().nullable(),
  requestId: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
const exportResponseSchema = z.object({
  schemaVersion: z.number().int().positive(),
  generatedAt: z.string(),
  range: z.object({
    from: dateStringSchema,
    to: dateStringSchema,
    days: z.number().int().positive(),
  }),
  counts: z.object({
    businessDays: z.number().int().nonnegative(),
    reservations: z.number().int().nonnegative(),
    privateBlockAuditLogs: z.number().int().nonnegative(),
  }),
  businessDays: z.array(businessDaySchema),
  reservations: z.array(reservationSchema),
  privateBlockAuditLogs: z.array(privateBlockAuditLogSchema),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  requestId: z.string(),
  maxExportRangeDays: z.number().int().positive().optional(),
});

type BackupExportResponse = z.infer<typeof exportResponseSchema>;

type DayBackupFile = {
  schemaVersion: number;
  pulledAt: string;
  date: string;
  source: {
    baseUrl: string;
    routePath: string;
    range: {
      from: string;
      to: string;
    };
    checksumSha256: string;
    requestId: string;
  };
  businessDay: z.infer<typeof businessDaySchema> | null;
  reservations: Array<z.infer<typeof reservationSchema>>;
  privateBlockAuditLogs: Array<z.infer<typeof privateBlockAuditLogSchema>>;
  counts: {
    reservations: number;
    privateBlockAuditLogs: number;
  };
};

function groupByDate<T extends { date: string }>(rows: T[]) {
  return rows.reduce<Record<string, T[]>>((acc, row) => {
    const current = acc[row.date] ?? [];
    current.push(row);
    acc[row.date] = current;
    return acc;
  }, {});
}

function buildChunkRanges(from: string, to: string, chunkDays: number) {
  const dates = enumerateDateStrings(from, to);
  const chunks: Array<{ from: string; to: string }> = [];
  for (let index = 0; index < dates.length; index += chunkDays) {
    const chunkFrom = dates[index];
    const chunkTo = dates[Math.min(index + chunkDays - 1, dates.length - 1)];
    chunks.push({ from: chunkFrom, to: chunkTo });
  }
  return chunks;
}

function buildExportUrl(baseUrl: string, routePath: string, from: string, to: string) {
  const normalizedPath = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const url = new URL(normalizedPath, `${baseUrl}/`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  return url;
}

async function fetchChunk(
  url: URL,
  secret: string,
  options: {
    basicAuthHeader: string | null;
  }
) {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-backup-export-secret": secret,
  };

  if (options.basicAuthHeader) {
    headers.authorization = options.basicAuthHeader;
  } else {
    headers.authorization = `Bearer ${secret}`;
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  const raw = await response.text();
  let json: unknown = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    const contentType = response.headers.get("content-type") ?? "(none)";
    throw new Error(
      `バックアップAPIのレスポンスがJSONではありません [status=${response.status} content-type=${contentType}]: ${
        raw.slice(0, 240) || "(empty)"
      }`
    );
  }

  if (!response.ok) {
    const errorText =
      typeof json === "object" && json && "error" in json
        ? String((json as Record<string, unknown>).error)
        : raw.slice(0, 240);
    throw new Error(`バックアップAPIエラー [${response.status}]: ${errorText}`);
  }

  const parsed = exportResponseSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`バックアップAPIレスポンス検証失敗: ${issue.path.join(".")} ${issue.message}`);
  }

  return parsed.data;
}

async function main() {
  const cwd = process.cwd();
  const cli = parseCliArgs(process.argv.slice(2));
  const env = loadMergedEnv(cwd);

  const baseUrlRaw = readOption(cli, "base-url") ?? env.BACKUP_BASE_URL ?? env.BASE_URL;
  if (!baseUrlRaw) {
    throw new Error(
      "BASE_URL が見つかりません。`--base-url` か `BACKUP_BASE_URL` / `BASE_URL` を設定してください"
    );
  }

  const secret = readOption(cli, "secret") ?? env.BACKUP_EXPORT_SECRET;
  if (!secret) {
    throw new Error(
      "バックアップ認証トークンが見つかりません。`--secret` か `BACKUP_EXPORT_SECRET` を設定してください。CRON_SECRET は使用しません"
    );
  }

  const routePath = readOption(cli, "route-path") ?? DEFAULT_ROUTE_PATH;
  const outputDir = resolveOutputDir(cwd, readOption(cli, "out-dir") ?? env.BACKUP_OUTPUT_DIR);
  const dryRun = readOption(cli, "dry-run") === "true";
  const adminUser = readOption(cli, "admin-user") ?? env.ADMIN_BASIC_USER ?? "";
  const adminPass = readOption(cli, "admin-pass") ?? env.ADMIN_BASIC_PASS ?? "";

  if ((adminUser && !adminPass) || (!adminUser && adminPass)) {
    throw new Error(
      "管理APIにアクセスするための Basic 認証情報が不足しています。`ADMIN_BASIC_USER` と `ADMIN_BASIC_PASS` の両方を指定してください"
    );
  }

  const routeNeedsBasicAuth = routePath === "/api/admin" || routePath.startsWith("/api/admin/");
  if (routeNeedsBasicAuth && (!adminUser || !adminPass)) {
    throw new Error(
      "`/api/admin` ルートへのアクセスには Basic 認証が必要です。`ADMIN_BASIC_USER` と `ADMIN_BASIC_PASS` を設定してください"
    );
  }

  const basicAuthHeader =
    adminUser && adminPass
      ? `Basic ${Buffer.from(`${adminUser}:${adminPass}`).toString("base64")}`
      : null;

  const lookbackDays = parsePositiveInt(
    readOption(cli, "lookback-days") ?? env.BACKUP_LOOKBACK_DAYS,
    DEFAULT_LOOKBACK_DAYS,
    "--lookback-days"
  );
  const lookaheadDays = parsePositiveInt(
    readOption(cli, "lookahead-days") ?? env.BACKUP_LOOKAHEAD_DAYS,
    DEFAULT_LOOKAHEAD_DAYS,
    "--lookahead-days"
  );

  const rawChunkDays = parsePositiveInt(
    readOption(cli, "chunk-days") ?? env.BACKUP_CHUNK_DAYS,
    DEFAULT_CHUNK_DAYS,
    "--chunk-days"
  );
  const chunkDays = Math.min(rawChunkDays, MAX_EXPORT_RANGE_DAYS);
  if (chunkDays !== rawChunkDays) {
    console.warn(
      `[backup:pull] --chunk-days が上限 ${MAX_EXPORT_RANGE_DAYS} を超えていたため ${chunkDays} に調整しました`
    );
  }

  const fromOption = readOption(cli, "from");
  const toOption = readOption(cli, "to");
  if ((fromOption && !toOption) || (!fromOption && toOption)) {
    throw new Error("`--from` と `--to` は両方指定してください");
  }

  const today = parseDateStrict(getTodayJstDateString(), "today");
  const from = fromOption
    ? formatDateUtc(parseDateStrict(fromOption, "--from"))
    : formatDateUtc(addDaysUtc(today, -lookbackDays));
  const to = toOption
    ? formatDateUtc(parseDateStrict(toOption, "--to"))
    : formatDateUtc(addDaysUtc(today, lookaheadDays));

  if (from > to) {
    throw new Error("`from` は `to` 以下の日付にしてください");
  }

  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  const chunks = buildChunkRanges(from, to, chunkDays);

  const daysDir = path.join(outputDir, "days");
  const runsDir = path.join(outputDir, "runs");
  if (!dryRun) {
    await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
    await fs.chmod(outputDir, 0o700);
    await fs.mkdir(daysDir, { recursive: true, mode: 0o700 });
    await fs.chmod(daysDir, 0o700);
    await fs.mkdir(runsDir, { recursive: true, mode: 0o700 });
    await fs.chmod(runsDir, 0o700);
  }

  const pulledAt = new Date().toISOString();
  const chunkSummaries: Array<{
    from: string;
    to: string;
    requestId: string;
    checksumSha256: string;
    counts: BackupExportResponse["counts"];
  }> = [];
  let dayFilesWritten = 0;
  let totalReservations = 0;
  let totalBusinessDays = 0;
  let totalPrivateBlockAuditLogs = 0;

  for (const chunk of chunks) {
    const exportUrl = buildExportUrl(baseUrl, routePath, chunk.from, chunk.to);
    console.info(`[backup:pull] 取得中: ${chunk.from} -> ${chunk.to}`);
    const exported = await fetchChunk(exportUrl, secret, { basicAuthHeader });

    const businessDayByDate = new Map(exported.businessDays.map((row) => [row.date, row]));
    const reservationsByDate = groupByDate(exported.reservations);
    const auditByDate = groupByDate(exported.privateBlockAuditLogs);

    const datesInChunk = enumerateDateStrings(exported.range.from, exported.range.to);
    for (const date of datesInChunk) {
      const dayPayload: DayBackupFile = {
        schemaVersion: exported.schemaVersion,
        pulledAt,
        date,
        source: {
          baseUrl,
          routePath,
          range: {
            from: exported.range.from,
            to: exported.range.to,
          },
          checksumSha256: exported.checksumSha256,
          requestId: exported.requestId,
        },
        businessDay: businessDayByDate.get(date) ?? null,
        reservations: reservationsByDate[date] ?? [],
        privateBlockAuditLogs: auditByDate[date] ?? [],
        counts: {
          reservations: (reservationsByDate[date] ?? []).length,
          privateBlockAuditLogs: (auditByDate[date] ?? []).length,
        },
      };

      if (!dryRun) {
        const dayPath = path.join(daysDir, `${date}.json`);
        await fs.writeFile(dayPath, `${JSON.stringify(dayPayload, null, 2)}\n`, "utf8");
        await fs.chmod(dayPath, 0o600);
      }

      dayFilesWritten += 1;
    }

    totalBusinessDays += exported.counts.businessDays;
    totalReservations += exported.counts.reservations;
    totalPrivateBlockAuditLogs += exported.counts.privateBlockAuditLogs;
    chunkSummaries.push({
      from: exported.range.from,
      to: exported.range.to,
      requestId: exported.requestId,
      checksumSha256: exported.checksumSha256,
      counts: exported.counts,
    });
  }

  const runSummary = {
    schemaVersion: 1,
    pulledAt,
    dryRun,
    config: {
      baseUrl,
      routePath,
      outputDir,
      from,
      to,
      lookbackDays,
      lookaheadDays,
      chunkDays,
      chunkCount: chunks.length,
    },
    totals: {
      dayFilesWritten,
      businessDays: totalBusinessDays,
      reservations: totalReservations,
      privateBlockAuditLogs: totalPrivateBlockAuditLogs,
    },
    chunks: chunkSummaries,
  };

  if (!dryRun) {
    const runFilePath = path.join(runsDir, `pull-${createTimestampLabel()}.json`);
    await fs.writeFile(runFilePath, `${JSON.stringify(runSummary, null, 2)}\n`, "utf8");
    await fs.chmod(runFilePath, 0o600);
    const latestRunPath = path.join(outputDir, "latest-run.json");
    await fs.writeFile(latestRunPath, `${JSON.stringify(runSummary, null, 2)}\n`, "utf8");
    await fs.chmod(latestRunPath, 0o600);
  }

  console.info(
    `[backup:pull] 完了 dayFiles=${dayFilesWritten} reservations=${totalReservations} businessDays=${totalBusinessDays} auditLogs=${totalPrivateBlockAuditLogs}${dryRun ? " (dry-run)" : ""}`
  );
}

main().catch((error) => {
  console.error(`[backup:pull] 失敗: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
