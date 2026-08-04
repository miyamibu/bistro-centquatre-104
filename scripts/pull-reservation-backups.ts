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
import {
  BACKUP_ENCRYPTION_ALGORITHM,
  BACKUP_ENCRYPTION_FORMAT,
  BACKUP_ENCRYPTION_VERSION,
  encryptBackupPayload,
  resolveBackupEncryptionConfig,
} from "./backup-encryption.mjs";

const DEFAULT_ROUTE_PATH = "/api/admin/backups/reservations/export";
const BACKUP_SCHEMA_VERSION = 3;
const SUPPORTED_API_SCHEMA_VERSIONS = [2, 3] as const;

const dateStringSchema = z.string().regex(DATE_PATTERN);
const businessDaySchema = z.object({
  id: z.string(),
  date: dateStringSchema,
  isClosed: z.boolean(),
  note: z.string().nullable(),
});
const businessDayAuditLogSchema = z.object({
  id: z.string(),
  businessDayId: z.string(),
  date: dateStringSchema,
  previousIsClosed: z.boolean().nullable(),
  nextIsClosed: z.boolean(),
  previousNote: z.string().nullable(),
  nextNote: z.string().nullable(),
  actorName: z.string().nullable().optional(),
  actorUserId: z.string().nullable().optional(),
  actorEmail: z.string().nullable().optional(),
  actorRole: z.string().nullable().optional(),
  requestId: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
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
  customerEmail: z.string().email().nullable().optional(),
  customerEmailVerifiedAt: z.string().nullable().optional(),
  contactChannel: z.enum(["EMAIL", "LINE"]).nullable().optional(),
  note: z.string().nullable(),
  status: z.enum(["CONFIRMED", "CANCELLED", "DONE", "NOSHOW"]),
  cancellationPolicyVersion: z.string().nullable().optional(),
  cancellationPolicyAcceptedAt: z.string().nullable().optional(),
  cancelledAt: z.string().nullable().optional(),
  cancelSource: z.string().nullable().optional(),
  cancellationReason: z.string().nullable().optional(),
  lineUserId: z.string().nullable(),
  lineReminderSentAt: z.string().nullable(),
  lineReminderStatus: z.string().nullable(),
  lineReminderError: z.string().nullable(),
  lineClaimTokenHash: z.string().nullable(),
  lineClaimExpiresAt: z.string().nullable(),
  lineConfirmationSentAt: z.string().nullable(),
  lineLinkedAt: z.string().nullable(),
  lineLinkSource: z.string().nullable(),
  linePushStatus: z.string().nullable(),
  linePushCheckedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const privateBlockAuditLogSchema = z.object({
  id: z.string(),
  reservationId: z.string().nullable(),
  date: dateStringSchema,
  servicePeriod: z.enum(["LUNCH", "DINNER"]),
  result: z.enum(["CREATED", "NO_OP", "RELEASED"]),
  source: z.enum(["PUBLIC_FORM", "ADMIN_USER"]),
  actorName: z.string().nullable(),
  actorUserId: z.string().nullable().optional(),
  actorEmail: z.string().nullable().optional(),
  actorRole: z.string().nullable().optional(),
  operatorLabel: z.string().nullable().optional(),
  requestId: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
const reservationStatusAuditLogSchema = z.object({
  id: z.string(),
  reservationId: z.string(),
  actorName: z.string().nullable(),
  actorUserId: z.string().nullable().optional(),
  actorEmail: z.string().nullable().optional(),
  actorRole: z.string().nullable().optional(),
  operatorLabel: z.string().nullable().optional(),
  requestId: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  previousStatus: z.enum(["CONFIRMED", "CANCELLED", "DONE", "NOSHOW"]),
  nextStatus: z.enum(["CONFIRMED", "CANCELLED", "DONE", "NOSHOW"]),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
const reservationEmailOutboxSchema = z.object({
  id: z.string(),
  reservationId: z.string(),
  notificationType: z.string(),
  status: z.string(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: z.string().nullable(),
  claimedAt: z.string().nullable(),
  lockedUntil: z.string().nullable(),
  sentAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const reservationCorrectionAuditLogSchema = z.object({
  id: z.string(),
  reservationId: z.string(),
  actorName: z.string().nullable(),
  actorUserId: z.string().nullable().optional(),
  actorEmail: z.string().nullable().optional(),
  actorRole: z.string().nullable().optional(),
  requestId: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  reason: z.string(),
  beforeData: z.unknown(),
  afterData: z.unknown(),
  createdAt: z.string(),
});
const reservationLineLinkTokenSchema = z.object({
  id: z.string(),
  reservationId: z.string(),
  tokenHash: z.string(),
  keyId: z.string().optional(),
  expiresAt: z.string(),
  usedAt: z.string().nullable(),
  createdAt: z.string(),
});
const notificationEventSchema = z.object({
  id: z.string(),
  reservationId: z.string(),
  channel: z.string(),
  type: z.string(),
  targetDate: dateStringSchema,
  status: z.string(),
  retryKey: z.string(),
  claimedAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const exportResponseSchema = z.object({
  schemaVersion: z.union([
    z.literal(SUPPORTED_API_SCHEMA_VERSIONS[0]),
    z.literal(SUPPORTED_API_SCHEMA_VERSIONS[1]),
  ]),
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
    businessDayAuditLogs: z.number().int().nonnegative().optional().default(0),
    reservationStatusAuditLogs: z.number().int().nonnegative(),
    reservationCorrectionAuditLogs: z.number().int().nonnegative().optional().default(0),
    reservationEmailOutbox: z.number().int().nonnegative(),
    reservationLineLinkTokens: z.number().int().nonnegative(),
    notificationEvents: z.number().int().nonnegative(),
  }),
  businessDays: z.array(businessDaySchema),
  businessDayAuditLogs: z.array(businessDayAuditLogSchema).default([]),
  reservations: z.array(reservationSchema),
  privateBlockAuditLogs: z.array(privateBlockAuditLogSchema),
  reservationStatusAuditLogs: z.array(reservationStatusAuditLogSchema),
  reservationCorrectionAuditLogs: z.array(reservationCorrectionAuditLogSchema).default([]),
  reservationEmailOutbox: z.array(reservationEmailOutboxSchema),
  reservationLineLinkTokens: z.array(reservationLineLinkTokenSchema),
  notificationEvents: z.array(notificationEventSchema),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  requestId: z.string(),
  maxExportRangeDays: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  const countPairs = [
    ["businessDays", value.businessDays.length],
    ["reservations", value.reservations.length],
    ["privateBlockAuditLogs", value.privateBlockAuditLogs.length],
    ["businessDayAuditLogs", value.businessDayAuditLogs.length],
    ["reservationStatusAuditLogs", value.reservationStatusAuditLogs.length],
    ["reservationCorrectionAuditLogs", value.reservationCorrectionAuditLogs.length],
    ["reservationEmailOutbox", value.reservationEmailOutbox.length],
    ["reservationLineLinkTokens", value.reservationLineLinkTokens.length],
    ["notificationEvents", value.notificationEvents.length],
  ] as const;

  for (const [key, actualCount] of countPairs) {
    if (value.counts[key] !== actualCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["counts", key],
        message: `counts.${key} が配列件数と一致しません`,
      });
    }
  }
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
  businessDayAuditLogs: Array<z.infer<typeof businessDayAuditLogSchema>>;
  reservations: Array<z.infer<typeof reservationSchema>>;
  privateBlockAuditLogs: Array<z.infer<typeof privateBlockAuditLogSchema>>;
  reservationStatusAuditLogs: Array<z.infer<typeof reservationStatusAuditLogSchema>>;
  reservationCorrectionAuditLogs: Array<z.infer<typeof reservationCorrectionAuditLogSchema>>;
  reservationEmailOutbox: Array<z.infer<typeof reservationEmailOutboxSchema>>;
  reservationLineLinkTokens: Array<z.infer<typeof reservationLineLinkTokenSchema>>;
  notificationEvents: Array<z.infer<typeof notificationEventSchema>>;
  counts: {
    businessDays: number;
    businessDayAuditLogs: number;
    reservations: number;
    privateBlockAuditLogs: number;
    reservationStatusAuditLogs: number;
    reservationCorrectionAuditLogs: number;
    reservationEmailOutbox: number;
    reservationLineLinkTokens: number;
    notificationEvents: number;
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

function groupByReservationDate<T extends { reservationId: string }>(
  rows: T[],
  reservationDateById: Map<string, string>
) {
  return rows.reduce<Record<string, T[]>>((acc, row) => {
    const date = reservationDateById.get(row.reservationId);
    if (!date) {
      throw new Error(`関連バックアップ行のreservationIdが同じexport内に存在しません: ${row.reservationId}`);
    }
    const current = acc[date] ?? [];
    current.push(row);
    acc[date] = current;
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
) {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-backup-export-secret": secret,
  };

  headers.authorization = `Bearer ${secret}`;

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

  for (const option of ["secret", "admin-pass", "admin-user"]) {
    if (cli.has(option)) {
      throw new Error(`--${option} は使用できません。認証情報は環境変数で設定してください`);
    }
  }

  const env = loadMergedEnv(cwd);

  const baseUrlRaw = readOption(cli, "base-url") ?? env.BACKUP_BASE_URL ?? env.BASE_URL;
  if (!baseUrlRaw) {
    throw new Error(
      "BASE_URL が見つかりません。`--base-url` か `BACKUP_BASE_URL` / `BASE_URL` を設定してください"
    );
  }

  const secret = env.BACKUP_EXPORT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "バックアップ認証トークンが見つかりません。BACKUP_EXPORT_SECRET を環境変数で設定してください。CRON_SECRET は使用しません"
    );
  }

  const routePath = readOption(cli, "route-path") ?? DEFAULT_ROUTE_PATH;
  const outputDir = resolveOutputDir(cwd, readOption(cli, "out-dir") ?? env.BACKUP_OUTPUT_DIR);
  const dryRun = readOption(cli, "dry-run") === "true";
  const encryptionConfig = dryRun
    ? null
    : await resolveBackupEncryptionConfig({
        environment: env,
        readFromStdin: readOption(cli, "encryption-key-stdin") === "true",
      });

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
  let totalBusinessDayAuditLogs = 0;
  let totalReservationStatusAuditLogs = 0;
  let totalReservationCorrectionAuditLogs = 0;
  let totalReservationEmailOutbox = 0;
  let totalReservationLineLinkTokens = 0;
  let totalNotificationEvents = 0;

  for (const chunk of chunks) {
    const exportUrl = buildExportUrl(baseUrl, routePath, chunk.from, chunk.to);
    console.info(`[backup:pull] 取得中: ${chunk.from} -> ${chunk.to}`);
    const exported = await fetchChunk(exportUrl, secret);

    const businessDayByDate = new Map(exported.businessDays.map((row) => [row.date, row]));
    const businessDayAuditByDate = groupByDate(exported.businessDayAuditLogs);
    const reservationsByDate = groupByDate(exported.reservations);
    const auditByDate = groupByDate(exported.privateBlockAuditLogs);
    const reservationDateById = new Map(exported.reservations.map((row) => [row.id, row.date]));
    const statusAuditByDate = groupByReservationDate(
      exported.reservationStatusAuditLogs,
      reservationDateById
    );
    const correctionAuditByDate = groupByReservationDate(
      exported.reservationCorrectionAuditLogs,
      reservationDateById
    );
    const emailOutboxByDate = groupByReservationDate(
      exported.reservationEmailOutbox,
      reservationDateById
    );
    const lineLinkTokensByDate = groupByReservationDate(
      exported.reservationLineLinkTokens,
      reservationDateById
    );
    const notificationEventsByDate = groupByReservationDate(
      exported.notificationEvents,
      reservationDateById
    );

    const datesInChunk = enumerateDateStrings(exported.range.from, exported.range.to);
    for (const date of datesInChunk) {
      const dayPayload: DayBackupFile = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
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
        businessDayAuditLogs: businessDayAuditByDate[date] ?? [],
        reservations: reservationsByDate[date] ?? [],
        privateBlockAuditLogs: auditByDate[date] ?? [],
        reservationStatusAuditLogs: statusAuditByDate[date] ?? [],
        reservationCorrectionAuditLogs: correctionAuditByDate[date] ?? [],
        reservationEmailOutbox: emailOutboxByDate[date] ?? [],
        reservationLineLinkTokens: lineLinkTokensByDate[date] ?? [],
        notificationEvents: notificationEventsByDate[date] ?? [],
        counts: {
          businessDays: businessDayByDate.has(date) ? 1 : 0,
          businessDayAuditLogs: (businessDayAuditByDate[date] ?? []).length,
          reservations: (reservationsByDate[date] ?? []).length,
          privateBlockAuditLogs: (auditByDate[date] ?? []).length,
          reservationStatusAuditLogs: (statusAuditByDate[date] ?? []).length,
          reservationCorrectionAuditLogs: (correctionAuditByDate[date] ?? []).length,
          reservationEmailOutbox: (emailOutboxByDate[date] ?? []).length,
          reservationLineLinkTokens: (lineLinkTokensByDate[date] ?? []).length,
          notificationEvents: (notificationEventsByDate[date] ?? []).length,
        },
      };

      if (!dryRun) {
        const dayPath = path.join(daysDir, `${date}.json.enc`);
        const encrypted = encryptBackupPayload(dayPayload, encryptionConfig.secret, {
          keyId: encryptionConfig.keyId,
        });
        await fs.writeFile(dayPath, `${encrypted}\n`, "utf8");
        await fs.chmod(dayPath, 0o600);
      }

      dayFilesWritten += 1;
    }

    totalBusinessDays += exported.counts.businessDays;
    totalReservations += exported.counts.reservations;
    totalPrivateBlockAuditLogs += exported.counts.privateBlockAuditLogs;
    totalBusinessDayAuditLogs += exported.counts.businessDayAuditLogs;
    totalReservationStatusAuditLogs += exported.counts.reservationStatusAuditLogs;
    totalReservationCorrectionAuditLogs += exported.counts.reservationCorrectionAuditLogs;
    totalReservationEmailOutbox += exported.counts.reservationEmailOutbox;
    totalReservationLineLinkTokens += exported.counts.reservationLineLinkTokens;
    totalNotificationEvents += exported.counts.notificationEvents;
    chunkSummaries.push({
      from: exported.range.from,
      to: exported.range.to,
      requestId: exported.requestId,
      checksumSha256: exported.checksumSha256,
      counts: exported.counts,
    });
  }

  const runSummary = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    pulledAt,
    dryRun,
    encryption: dryRun
      ? null
      : {
          format: BACKUP_ENCRYPTION_FORMAT,
          encryptionVersion: BACKUP_ENCRYPTION_VERSION,
          algorithm: BACKUP_ENCRYPTION_ALGORITHM,
          keyId: encryptionConfig.keyId,
        },
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
      businessDayAuditLogs: totalBusinessDayAuditLogs,
      reservationStatusAuditLogs: totalReservationStatusAuditLogs,
      reservationCorrectionAuditLogs: totalReservationCorrectionAuditLogs,
      reservationEmailOutbox: totalReservationEmailOutbox,
      reservationLineLinkTokens: totalReservationLineLinkTokens,
      notificationEvents: totalNotificationEvents,
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
    `[backup:pull] 完了 dayFiles=${dayFilesWritten} reservations=${totalReservations} businessDays=${totalBusinessDays} auditLogs=${totalPrivateBlockAuditLogs} statusAudits=${totalReservationStatusAuditLogs} emailOutbox=${totalReservationEmailOutbox} lineLinkTokens=${totalReservationLineLinkTokens} notificationEvents=${totalNotificationEvents}${dryRun ? " (dry-run)" : ""}`
  );
}

main().catch((error) => {
  console.error(`[backup:pull] 失敗: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
