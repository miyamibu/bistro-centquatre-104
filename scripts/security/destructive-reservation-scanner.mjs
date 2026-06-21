import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SCAN_ROOTS = ["src", "tests", "scripts", "prisma"];
export const ALLOWED_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".sql",
]);
export const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "out",
]);

export const ALLOWLIST = new Map([
  [
    "tests/private-block-route-db.test.ts",
    {
      requiredFragments: [
        "safeTestDatabaseUrl",
        "Safe TEST_DATABASE_URL is required for destructive DB tests",
        "clearReservationArtifacts",
      ],
      reason: "Guarded cleanup for isolated local reservation DB contract tests",
    },
  ],
  [
    "tests/reservations-route-db.test.ts",
    {
      requiredFragments: [
        "safeTestDatabaseUrl",
        "Safe TEST_DATABASE_URL is required for destructive DB tests",
        "clearReservationArtifacts",
      ],
      reason: "Guarded cleanup for isolated local reservation DB route tests",
    },
  ],
  [
    "tests/utils/reservation-destructive-cleanup.ts",
    {
      requiredFragments: [
        "assertDestructiveCleanupAllowed",
        "assert-test-database",
        "RESERVATION_DESTRUCTIVE_TEST_ONLY",
      ],
      reason: "Guarded destructive cleanup helper for isolated test DB only",
    },
  ],
]);

const DETECTION_RULES = [
  { name: 'raw DELETE Reservation', regex: /DELETE\s+FROM\s+(?:"Reservation"|Reservation\b)/gi },
  {
    name: 'raw DELETE PrivateBlockAuditLog',
    regex: /DELETE\s+FROM\s+(?:"PrivateBlockAuditLog"|PrivateBlockAuditLog\b)/gi,
  },
  { name: 'raw DELETE BusinessDay', regex: /DELETE\s+FROM\s+(?:"BusinessDay"|BusinessDay\b)/gi },
  {
    name: 'raw TRUNCATE Reservation',
    regex: /TRUNCATE\s+(?:TABLE\s+)?(?:"Reservation"|Reservation\b)/gi,
  },
  {
    name: 'raw TRUNCATE PrivateBlockAuditLog',
    regex: /TRUNCATE\s+(?:TABLE\s+)?(?:"PrivateBlockAuditLog"|PrivateBlockAuditLog\b)/gi,
  },
  {
    name: 'raw TRUNCATE BusinessDay',
    regex: /TRUNCATE\s+(?:TABLE\s+)?(?:"BusinessDay"|BusinessDay\b)/gi,
  },
  {
    name: 'raw DROP TABLE Reservation',
    regex: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"Reservation"|Reservation\b)/gi,
  },
  {
    name: 'raw DROP TABLE PrivateBlockAuditLog',
    regex: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"PrivateBlockAuditLog"|PrivateBlockAuditLog\b)/gi,
  },
  {
    name: 'raw DROP TABLE BusinessDay',
    regex: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"BusinessDay"|BusinessDay\b)/gi,
  },
  { name: "prisma reservation.delete", regex: /\.reservation\.delete\s*\(/gi },
  { name: "prisma reservation.deleteMany", regex: /\.reservation\.deleteMany\s*\(/gi },
  { name: "prisma privateBlockAuditLog.delete", regex: /\.privateBlockAuditLog\.delete\s*\(/gi },
  {
    name: "prisma privateBlockAuditLog.deleteMany",
    regex: /\.privateBlockAuditLog\.deleteMany\s*\(/gi,
  },
  { name: "prisma businessDay.delete", regex: /\.businessDay\.delete\s*\(/gi },
  { name: "prisma businessDay.deleteMany", regex: /\.businessDay\.deleteMany\s*\(/gi },
  {
    name: "supabase Reservation delete",
    regex: /from\(\s*['"]Reservation['"]\s*\)\.delete\s*\(/gi,
  },
  {
    name: "supabase PrivateBlockAuditLog delete",
    regex: /from\(\s*['"]PrivateBlockAuditLog['"]\s*\)\.delete\s*\(/gi,
  },
  {
    name: "supabase BusinessDay delete",
    regex: /from\(\s*['"]BusinessDay['"]\s*\)\.delete\s*\(/gi,
  },
  {
    name: "protected backup or evidence fs delete",
    regex:
      /(?:fs(?:\.promises)?|fsp)\.(?:rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\([\s\S]{0,220}?(?:reservation-status|reservation-daily-backups|manual-export-backups|docs[\\/]+recovery|manual-restore|production-launch|release-readiness|deliverables|evidence)/gi,
  },
  {
    name: "protected backup or evidence shell rm",
    regex:
      /\brm\s+-r[fF]?\s+[\s\S]{0,220}?(?:reservation-status|reservation-daily-backups|manual-export-backups|docs\/recovery|manual-restore|production-launch|release-readiness|deliverables|evidence)/gi,
  },
];

function toPosixPath(inputPath) {
  return inputPath.split(path.sep).join("/");
}

function shouldSkipRelativePath(relativePath) {
  return (
    relativePath === "scripts/security/check-destructive-reservation-queries.mjs" ||
    relativePath === "scripts/security/destructive-reservation-scanner.mjs"
  );
}

function walkFiles(rootPath, dirPath, out) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = toPosixPath(path.relative(rootPath, absolutePath));
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walkFiles(rootPath, absolutePath, out);
      continue;
    }
    if (!ALLOWED_FILE_EXTENSIONS.has(path.extname(entry.name)) || shouldSkipRelativePath(relativePath)) {
      continue;
    }
    out.push({ absolutePath, relativePath });
  }
}

export function lineFromIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

export function scanSource(relativePath, source) {
  const allow = ALLOWLIST.get(relativePath);
  const violations = [];
  for (const rule of DETECTION_RULES) {
    rule.regex.lastIndex = 0;
    const matches = [...source.matchAll(rule.regex)];
    if (matches.length === 0 || allow) continue;
    for (const match of matches) {
      violations.push({
        file: relativePath,
        line: lineFromIndex(source, match.index ?? 0),
        rule: rule.name,
      });
    }
  }
  if (allow) {
    const missingGuard = allow.requiredFragments.filter((fragment) => !source.includes(fragment));
    if (missingGuard.length > 0) {
      violations.push({
        file: relativePath,
        line: 1,
        rule: `allowlist guard missing (${missingGuard.join(", ")})`,
      });
    }
  }
  return violations;
}

export function scanWorkspace(rootPath = process.cwd(), scanRoots = DEFAULT_SCAN_ROOTS) {
  const files = [];
  for (const root of scanRoots) {
    const absoluteRoot = path.join(rootPath, root);
    if (fs.existsSync(absoluteRoot)) walkFiles(rootPath, absoluteRoot, files);
  }
  const violations = [];
  for (const file of files) {
    violations.push(...scanSource(file.relativePath, fs.readFileSync(file.absolutePath, "utf8")));
  }
  return { files, violations };
}
