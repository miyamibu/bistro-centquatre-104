#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

DRY_RUN=0
OUT_DIR=""

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --out-dir=*)
      OUT_DIR="${arg#--out-dir=}"
      ;;
    *)
      echo "[backup:project-snapshot] unknown option: ${arg}" >&2
      exit 1
      ;;
  esac
done

if [ -z "${OUT_DIR}" ]; then
  if [ -n "${BISTRO_SNAPSHOT_DIR:-}" ]; then
    OUT_DIR="${BISTRO_SNAPSHOT_DIR}"
  elif [ -n "${BISTRO_BACKUP_DIR:-}" ]; then
    OUT_DIR="$(cd "${BISTRO_BACKUP_DIR}/.." && pwd)/project-snapshots"
  else
    OUT_DIR="${PROJECT_DIR}/backups/project-snapshots"
  fi
fi

if [[ "${OUT_DIR}" != /* ]]; then
  OUT_DIR="${PROJECT_DIR}/${OUT_DIR}"
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_PATH="${OUT_DIR}/bistro-reservation-snapshot-${TIMESTAMP}.tar.gz"
RUN_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ "${DRY_RUN}" -eq 1 ]; then
  echo "[backup:project-snapshot] dry-run archive=${ARCHIVE_PATH} runAt=${RUN_AT}"
  exit 0
fi

mkdir -p "${OUT_DIR}"
chmod 700 "${OUT_DIR}" || true

tar \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='dist' \
  --exclude='build' \
  --exclude='coverage' \
  --exclude='backups/reservation-daily-backups' \
  --exclude='backups/manual-export-backups' \
  --exclude='backups/project-snapshots' \
  --exclude='backups/workspace-snapshots' \
  --exclude='*.log' \
  -czf "${ARCHIVE_PATH}" \
  -C "${PROJECT_DIR}" \
  .

chmod 600 "${ARCHIVE_PATH}" || true

echo "[backup:project-snapshot] archive=${ARCHIVE_PATH} runAt=${RUN_AT}"
