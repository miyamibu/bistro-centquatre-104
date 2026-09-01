import { createHash } from "node:crypto";

const SUPPORTED_SCHEMA_VERSIONS = new Set([2, 3, 4]);

const SCHEMA_4_COUNT_KEYS = ["reservationManagementTokens", "reservationIdempotencyRecords"];

function selectCounts(counts, schemaVersion) {
  const selected = {};
  const keys = [
    "businessDays",
    "reservations",
    "privateBlockAuditLogs",
    ...(schemaVersion >= 3 ? ["businessDayAuditLogs"] : []),
    "reservationStatusAuditLogs",
    ...(schemaVersion >= 3 ? ["reservationCorrectionAuditLogs"] : []),
    "reservationEmailOutbox",
    "reservationLineLinkTokens",
    ...(schemaVersion >= 4 ? SCHEMA_4_COUNT_KEYS : []),
    "notificationEvents",
  ];

  for (const key of keys) selected[key] = counts?.[key];
  return selected;
}

function selectCanonicalPayload(payload, schemaVersion) {
  if (!SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    throw new Error("予約バックアップchecksumのschemaVersionが未対応です");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("予約バックアップchecksum対象がオブジェクトではありません");
  }

  return {
    schemaVersion,
    range: payload.range,
    counts: selectCounts(payload.counts, schemaVersion),
    businessDays: payload.businessDays,
    ...(schemaVersion >= 3 ? { businessDayAuditLogs: payload.businessDayAuditLogs } : {}),
    reservations: payload.reservations,
    privateBlockAuditLogs: payload.privateBlockAuditLogs,
    reservationStatusAuditLogs: payload.reservationStatusAuditLogs,
    ...(schemaVersion >= 3
      ? { reservationCorrectionAuditLogs: payload.reservationCorrectionAuditLogs }
      : {}),
    reservationEmailOutbox: payload.reservationEmailOutbox,
    reservationLineLinkTokens: payload.reservationLineLinkTokens,
    ...(schemaVersion >= 4
      ? {
          reservationManagementTokens: payload.reservationManagementTokens,
          reservationIdempotencyRecords: payload.reservationIdempotencyRecords,
        }
      : {}),
    notificationEvents: payload.notificationEvents,
  };
}

export function computeReservationBackupChecksum(payload, schemaVersion = payload?.schemaVersion) {
  const canonical = selectCanonicalPayload(payload, schemaVersion);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function reservationBackupChecksumMatches(payload, expectedChecksum, schemaVersion) {
  if (typeof expectedChecksum !== "string" || !/^[0-9a-f]{64}$/.test(expectedChecksum)) {
    return false;
  }
  return computeReservationBackupChecksum(payload, schemaVersion) === expectedChecksum;
}

export function computeReservationDayBackupChecksum(payload) {
  const businessDays = Array.isArray(payload?.businessDays)
    ? payload.businessDays
    : payload?.businessDay
      ? [payload.businessDay]
      : [];
  const date = payload?.date;
  return computeReservationBackupChecksum(
    {
      ...payload,
      range: { from: date, to: date, days: 1 },
      businessDays,
    },
    payload?.schemaVersion,
  );
}
