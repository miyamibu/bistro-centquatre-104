#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import puppeteer from "puppeteer";

const STORE_NAME = "bistro centquatre 104";
const PROJECT_NAME = "bistro centquatre 104 予約サイト";
const PDF_TITLE = "bistro centquatre 104 予約サイト 完全プロジェクト把握レポート";
const GENERATOR = `Codex (GPT-5)`;

const ROOT = path.resolve(process.argv[2] ?? process.cwd());
const RELATIVE_OUTPUT_DIR = "deliverables";
const OUTPUT_DIR = path.join(ROOT, RELATIVE_OUTPUT_DIR);

const EXCLUDED_DIR_RULES = [
  {
    name: ".git",
    reason: "Gitメタデータであり本文全文掲載対象外",
  },
  {
    name: "node_modules",
    reason: "依存ライブラリ生成物であり本文全文掲載対象外",
  },
  {
    name: ".next",
    reason: "ビルド生成物であり本文全文掲載対象外",
  },
  {
    name: "coverage",
    reason: "テストカバレッジ生成物であり本文全文掲載対象外",
  },
  {
    name: "dist",
    reason: "ビルド生成物であり本文全文掲載対象外",
  },
  {
    name: "build",
    reason: "ビルド生成物であり本文全文掲載対象外",
  },
  {
    name: "runtime",
    reason: "ランタイム出力であり本文全文掲載対象外",
  },
  {
    name: "logs",
    reason: "ログ出力であり本文全文掲載対象外",
  },
  {
    name: "data",
    reason: "運用データ格納領域であり本文全文掲載対象外",
  },
  {
    name: RELATIVE_OUTPUT_DIR,
    reason: "生成成果物ディレクトリ（再帰汚染防止のため除外）",
  },
];

const SENSITIVE_ENV_KEYS = new Set([
  "APP_SECRET",
  "SESSION_SECRET",
  "CSRF_SECRET",
  "ADMIN_PASSWORD",
  "EMAIL_API_KEY",
  "SMS_API_KEY",
  "LINE_CHANNEL_SECRET",
  "WEBHOOK_SECRET",
  "METRICS_SECRET",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "BACKUP_EXPORT_SECRET",
  "PRIVATE_BLOCK_ACCESS_CODE",
  "BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY",
  "ADMIN_BASIC_PASS",
  "RESEND_API_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_LINK_TOKEN_PEPPER",
  // LIFF_ID (旧名) は廃止済み。
]);

const HIGH_RISK_DATA_PATH_PATTERNS = [
  /^docs\/recovery\/.+\.(csv|sql|md)$/i,
  /^backups\//i,
  /^runtime\//i,
  /^logs\//i,
];

const REQUIRED_API_CANDIDATES = [
  "POST /api/v1/reservations",
  "GET /api/v1/reservations/:reservationId",
  "PATCH /api/v1/reservations/:reservationId",
  "POST /api/v1/reservations/:reservationId/cancel",
  "POST /api/v1/reservations/:reservationId/change-request",
  "GET /api/v1/public/availability",
  "GET /api/v1/public/reservation-options",
  "POST /api/v1/public/reservations",
  "GET /api/v1/admin/reservations",
  "GET /api/v1/admin/reservations/today",
  "GET /api/v1/admin/reservations/tomorrow",
  "POST /api/v1/admin/reservations/:reservationId/confirm",
  "POST /api/v1/admin/reservations/:reservationId/cancel",
  "POST /api/v1/admin/reservations/:reservationId/no-show",
  "POST /api/v1/admin/availability/block",
  "DELETE /api/v1/admin/availability/block/:blockId",
  "notification関連API",
  "review関連API",
  "cancellation policy関連API",
  "staff auth関連API",
  "audit関連API",
  "healthz",
  "readyz",
  "metrics",
];

const EXPECTED_DB_TABLES = [
  "stores",
  "business_hours",
  "holidays",
  "temporary_closures",
  "rooms",
  "tables",
  "seats",
  "reservation_slots",
  "availability_blocks",
  "reservations",
  "reservation_guests",
  "reservation_courses",
  "reservation_requests",
  "reservation_status_history",
  "notification_events",
  "notification_templates",
  "staff_users",
  "staff_sessions",
  "audit_logs",
  "cancellation_policies",
  "cancellation_events",
  "no_show_events",
  "review_cases",
  "daily_close",
  "external_integrations",
  "settings",
];

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function formatDateStampJst(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}${map.month}${map.day}`;
}

function formatDateTimeJst(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return formatter.format(date);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function bytesLabel(size) {
  return `${size.toLocaleString("en-US")} bytes`;
}

function isDirectoryExcluded(name) {
  return EXCLUDED_DIR_RULES.find((rule) => rule.name === name) ?? null;
}

function getFileExclusionReason(relativePath) {
  const base = path.basename(relativePath);

  if (base === ".env" || base === ".env.local") {
    return "実値の環境変数ファイルのため掲載禁止";
  }

  if (/\.db$/i.test(base) || /\.sqlite$/i.test(base) || /\.sqlite3$/i.test(base)) {
    return "DBファイルは本文全文掲載対象外";
  }

  if (/\.(pem|key|p12|pfx)$/i.test(base)) {
    return "秘密鍵/証明書秘密鍵の可能性があるため掲載禁止";
  }

  if (/\.DS_Store$/i.test(base)) {
    return "OSメタデータのため本文全文掲載対象外";
  }

  return null;
}

function shouldTreatAsHighRiskDataArtifact(relativePath) {
  return HIGH_RISK_DATA_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function isLikelyText(buffer) {
  if (buffer.length === 0) {
    return true;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));

  for (const value of sample) {
    if (value === 0) {
      return false;
    }
  }

  let suspicious = 0;
  for (const value of sample) {
    const isControl = value < 7 || (value > 14 && value < 32);
    if (isControl) suspicious += 1;
  }

  const suspiciousRatio = suspicious / sample.length;
  return suspiciousRatio < 0.05;
}

function detectEncoding(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return "UTF-8 (BOM)";
  }
  return "UTF-8";
}

function decodeText(buffer) {
  return buffer.toString("utf8").replace(/\r\n/g, "\n");
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function joinCsvLine(cells) {
  return cells
    .map((cell) => {
      const needsQuotes = /[",\n]/.test(cell);
      if (!needsQuotes) {
        return cell;
      }
      return `"${cell.replace(/"/g, '""')}"`;
    })
    .join(",");
}

function redactCsv(content) {
  const lines = content.split("\n");
  if (lines.length === 0) {
    return { redacted: content, maskCount: 0 };
  }

  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const sensitiveHeaderKeywords = [
    "name",
    "phone",
    "email",
    "address",
    "note",
    "allergy",
    "request",
    "visible_names",
    "actor_name",
    "ip_address",
    "user_agent",
    "source",
    "reservation_id",
  ];

  const sensitiveIndexes = new Set();
  header.forEach((column, index) => {
    if (sensitiveHeaderKeywords.some((keyword) => column.includes(keyword))) {
      sensitiveIndexes.add(index);
    }
  });

  let maskCount = 0;
  const outputLines = [lines[0]];

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      outputLines.push(line);
      continue;
    }

    const cells = splitCsvLine(line);
    for (let col = 0; col < cells.length; col += 1) {
      if (sensitiveIndexes.has(col)) {
        if (cells[col] !== "") {
          cells[col] = "[REDACTED]";
          maskCount += 1;
        }
      }
    }

    outputLines.push(joinCsvLine(cells));
  }

  return {
    redacted: outputLines.join("\n"),
    maskCount,
  };
}

function redactEnvContent(content, isExample = false) {
  const lines = content.split("\n");
  let maskCount = 0;
  const output = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      return line;
    }

    const [rawKey, ...rawRest] = line.split("=");
    const key = rawKey.trim();
    const value = rawRest.join("=");

    if (!value) {
      return line;
    }

    if (isExample) {
      if (SENSITIVE_ENV_KEYS.has(key)) {
        maskCount += 1;
        return `${rawKey}=[REDACTED_SAMPLE_SECRET]`;
      }
      return line;
    }

    maskCount += 1;
    return `${rawKey}=[REDACTED_ENV_VALUE]`;
  });

  return { redacted: output.join("\n"), maskCount };
}

function redactGeneric(text) {
  let result = text;
  let maskCount = 0;

  const apply = (regex, replacement) => {
    result = result.replace(regex, (...args) => {
      maskCount += 1;
      if (typeof replacement === "function") {
        return replacement(...args);
      }
      return replacement;
    });
  };

  apply(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "[REDACTED_EMAIL]");

  result = result.replace(/(?:\+?\d[\d()\-\s]{6,}\d)/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length >= 10) {
      maskCount += 1;
      return "[REDACTED_PHONE]";
    }
    return match;
  });

  apply(/(Bearer\s+)[A-Za-z0-9._\-]{12,}/gi, "$1[REDACTED_TOKEN]");
  apply(/(postgres(?:ql)?:\/\/)[^\s"'`]+/gi, "$1[REDACTED_DB_CREDENTIALS]");
  apply(/(mysql:\/\/)[^\s"'`]+/gi, "$1[REDACTED_DB_CREDENTIALS]");

  apply(
    /(EMAIL_API_KEY|RESEND_API_KEY|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET|BACKUP_EXPORT_SECRET|PRIVATE_BLOCK_ACCESS_CODE|BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY|ADMIN_BASIC_PASS|LINE_CHANNEL_SECRET|LINE_CHANNEL_ACCESS_TOKEN|LINE_LINK_TOKEN_PEPPER)(\s*[:=]\s*["'])([^"'\n]+)(["'])/gi,
    "$1$2[REDACTED_SECRET]$4"
  );

  return { redacted: result, maskCount };
}

function redactHighRiskArtifact(text) {
  let redacted = text;
  let maskCount = 0;

  const csvResult = redactCsv(redacted);
  redacted = csvResult.redacted;
  maskCount += csvResult.maskCount;

  const genericResult = redactGeneric(redacted);
  redacted = genericResult.redacted;
  maskCount += genericResult.maskCount;

  redacted = redacted.replace(/'[^'\n]*[一-龯ぁ-ゔァ-ヴー][^'\n]*'/g, () => {
    maskCount += 1;
    return "'[REDACTED_TEXT]'";
  });

  redacted = redacted.replace(/\|\s*[^|\n]*[一-龯ぁ-ゔァ-ヴー]{1,6}\s*[一-龯ぁ-ゔァ-ヴー]{0,6}\s*\|/g, () => {
    maskCount += 1;
    return "| [REDACTED_NAME] |";
  });

  return { redacted, maskCount };
}

function redactContent(rawText, relativePath) {
  let text = rawText;
  let maskCount = 0;

  const base = path.basename(relativePath);
  const isEnvLike = base.startsWith(".env");
  const isExample = /example/i.test(base);

  if (isEnvLike) {
    const envRedaction = redactEnvContent(text, isExample);
    text = envRedaction.redacted;
    maskCount += envRedaction.maskCount;
  }

  if (shouldTreatAsHighRiskDataArtifact(relativePath)) {
    const highRiskRedaction = redactHighRiskArtifact(text);
    text = highRiskRedaction.redacted;
    maskCount += highRiskRedaction.maskCount;
  } else {
    const generic = redactGeneric(text);
    text = generic.redacted;
    maskCount += generic.maskCount;
  }

  return {
    redacted: text,
    maskCount,
  };
}

function inferRole(relativePath, isText) {
  if (!isText) {
    if (/^public\/photos\//.test(relativePath)) return "画像アセット";
    if (/^public\//.test(relativePath)) return "公開静的アセット";
    if (/tmp-.*\.(png|jpg|jpeg)$/i.test(path.basename(relativePath))) return "検証スクリーンショット";
    return "バイナリ資産";
  }

  if (relativePath === "README.md") return "プロジェクト概要";
  if (relativePath === "AGENTS.md") return "運用ルール";
  if (relativePath === "package.json") return "実行スクリプト/依存管理";
  if (relativePath.startsWith("src/app/api/")) return "APIルート実装";
  if (relativePath.startsWith("src/app/")) return "画面/ルート実装";
  if (relativePath.startsWith("src/components/")) return "UIコンポーネント";
  if (relativePath.startsWith("src/lib/")) return "ドメインロジック/共通処理";
  if (relativePath.startsWith("prisma/migrations/")) return "DBマイグレーション";
  if (relativePath === "prisma/schema.prisma") return "DBスキーマ定義";
  if (relativePath.startsWith("tests/")) return "テスト";
  if (relativePath.startsWith("docs/")) return "運用/設計ドキュメント";
  if (relativePath.startsWith("scripts/")) return "運用スクリプト";
  if (relativePath.startsWith(".github/workflows/")) return "CI設定";
  if (relativePath.startsWith("supabase/")) return "Supabase SQL/運用補助";
  if (relativePath.startsWith("public/")) return "公開静的ファイル";
  return "設定/補助ファイル";
}

function inferImportance(relativePath, isText) {
  if (!isText) return "Low";
  if (
    relativePath === "README.md" ||
    relativePath === "prisma/schema.prisma" ||
    relativePath === "src/app/api/reservations/route.ts" ||
    relativePath === "src/components/reserve-form.tsx" ||
    relativePath === "src/lib/reservation-capacity.ts" ||
    relativePath === "src/lib/booking-rules.ts"
  ) {
    return "High";
  }

  if (
    relativePath.startsWith("src/app/api/") ||
    relativePath.startsWith("src/lib/") ||
    relativePath.startsWith("prisma/") ||
    relativePath.startsWith("tests/")
  ) {
    return "Medium";
  }

  return "Low";
}

function inferRelatedSections(relativePath, isText) {
  if (!isText) return "15,16,22";
  if (relativePath.startsWith("src/app/api/")) return "4,5,8,11";
  if (relativePath.startsWith("src/components/") || relativePath.startsWith("src/app/")) return "5,9,10";
  if (relativePath.startsWith("src/lib/reservation") || relativePath.startsWith("src/lib/availability")) {
    return "5,6,7,8";
  }
  if (relativePath.startsWith("prisma/")) return "6,7,12";
  if (relativePath.startsWith("tests/")) return "14,17";
  if (relativePath.startsWith("docs/")) return "2,3,12,13,18";
  if (relativePath.startsWith("scripts/")) return "12,14";
  if (relativePath.startsWith(".github/workflows/")) return "12,14";
  if (relativePath.startsWith("public/")) return "9,22";
  return "1,15,16";
}

function inferPdfPlacement(isText, masked, relativePath) {
  if (!isText) return "一覧のみ";
  if (masked) return "マスク掲載";
  if (relativePath === "package-lock.json") return "抜粋掲載";
  return "全文掲載";
}

function countFilesRecursively(dirPath) {
  let count = 0;
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }

  return count;
}

function collectFiles(rootDir) {
  const result = {
    scannedFileCount: 0,
    textFiles: [],
    binaryFiles: [],
    excludedFiles: [],
    excludedDirectories: [],
    unreadableFiles: [],
    maskCount: 0,
    inventoryRows: [],
  };

  const stack = [""];

  while (stack.length > 0) {
    const relativeDir = stack.pop();
    const absoluteDir = path.join(rootDir, relativeDir);

    let entries = [];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch (error) {
      result.unreadableFiles.push({
        path: toPosix(relativeDir || "."),
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const entry of entries) {
      const relativePath = toPosix(path.join(relativeDir, entry.name));
      const absolutePath = path.join(rootDir, relativePath);

      if (entry.isDirectory()) {
        const exclusion = isDirectoryExcluded(entry.name);
        if (exclusion) {
          const excludedCount = countFilesRecursively(absolutePath);
          result.excludedDirectories.push({
            path: relativePath,
            reason: exclusion.reason,
            fileCount: excludedCount,
          });
          continue;
        }

        stack.push(relativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      result.scannedFileCount += 1;

      const exclusionReason = getFileExclusionReason(relativePath);
      if (exclusionReason) {
        let size = 0;
        try {
          size = fs.statSync(absolutePath).size;
        } catch {
          // ignore
        }

        result.excludedFiles.push({
          path: relativePath,
          reason: exclusionReason,
          size,
        });

        result.inventoryRows.push({
          path: relativePath,
          type: "excluded",
          size,
          sha256: "N/A",
          role: "除外対象ファイル",
          importance: "Low",
          relatedSections: "15,16",
          placement: "一覧のみ",
        });

        continue;
      }

      let buffer;
      try {
        buffer = fs.readFileSync(absolutePath);
      } catch (error) {
        result.unreadableFiles.push({
          path: relativePath,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const size = buffer.length;
      const hash = sha256(buffer);
      const isText = isLikelyText(buffer);
      const role = inferRole(relativePath, isText);
      const importance = inferImportance(relativePath, isText);
      const relatedSections = inferRelatedSections(relativePath, isText);

      if (isText) {
        const encoding = detectEncoding(buffer);
        const decoded = decodeText(buffer);
        const redaction = redactContent(decoded, relativePath);
        result.maskCount += redaction.maskCount;

        const textFile = {
          path: relativePath,
          size,
          encoding,
          sha256: hash,
          role,
          importance,
          relatedSections,
          content: redaction.redacted,
          masked: redaction.maskCount > 0,
        };

        result.textFiles.push(textFile);
        result.inventoryRows.push({
          path: relativePath,
          type: "text",
          size,
          sha256: hash,
          role,
          importance,
          relatedSections,
          placement: inferPdfPlacement(true, textFile.masked, relativePath),
        });
      } else {
        const extension = path.extname(relativePath).toLowerCase() || "(none)";

        const binaryFile = {
          path: relativePath,
          size,
          sha256: hash,
          extension,
          role,
          importance,
          relatedSections,
        };

        result.binaryFiles.push(binaryFile);
        result.inventoryRows.push({
          path: relativePath,
          type: "binary",
          size,
          sha256: hash,
          role,
          importance,
          relatedSections,
          placement: "一覧のみ",
        });
      }
    }
  }

  for (const excludedDir of result.excludedDirectories) {
    result.inventoryRows.push({
      path: `${excludedDir.path}/**`,
      type: "excluded_dir",
      size: excludedDir.fileCount,
      sha256: "N/A",
      role: "除外ディレクトリ",
      importance: "Low",
      relatedSections: "15,16",
      placement: "一覧のみ",
    });
  }

  result.textFiles.sort((a, b) => a.path.localeCompare(b.path));
  result.binaryFiles.sort((a, b) => a.path.localeCompare(b.path));
  result.excludedFiles.sort((a, b) => a.path.localeCompare(b.path));
  result.excludedDirectories.sort((a, b) => a.path.localeCompare(b.path));
  result.inventoryRows.sort((a, b) => a.path.localeCompare(b.path));
  result.unreadableFiles.sort((a, b) => a.path.localeCompare(b.path));

  return result;
}

function buildTree(paths, excludedDirectories) {
  const root = { dirs: new Map(), files: [] };

  const addPath = (relativePath, isDirectory = false) => {
    const segments = relativePath.split("/").filter(Boolean);
    if (segments.length === 0) return;

    let node = root;
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (isLast && !isDirectory) {
        node.files.push(segment);
      } else {
        if (!node.dirs.has(segment)) {
          node.dirs.set(segment, { dirs: new Map(), files: [] });
        }
        node = node.dirs.get(segment);
      }
    }
  };

  for (const filePath of paths) {
    addPath(filePath, false);
  }

  for (const excluded of excludedDirectories) {
    const label = `${excluded.path} [excluded: ${excluded.reason}; files=${excluded.fileCount}]`;
    addPath(label, false);
  }

  const lines = ["."];

  const render = (node, prefix) => {
    const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
    const fileNames = [...new Set(node.files)].sort((a, b) => a.localeCompare(b));
    const entries = [
      ...dirNames.map((name) => ({ type: "dir", name })),
      ...fileNames.map((name) => ({ type: "file", name })),
    ];

    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      const connector = isLast ? "└─ " : "├─ ";
      lines.push(`${prefix}${connector}${entry.name}`);
      if (entry.type === "dir") {
        const childPrefix = `${prefix}${isLast ? "   " : "│  "}`;
        render(node.dirs.get(entry.name), childPrefix);
      }
    });
  };

  render(root, "");
  return lines.join("\n");
}

function markdownEscapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function makeMarkdownTable(headers, rows) {
  const headerLine = `| ${headers.map(markdownEscapeCell).join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyLines = rows.map((row) => `| ${row.map(markdownEscapeCell).join(" | ")} |`);
  return [headerLine, separatorLine, ...bodyLines].join("\n");
}

function safeCodeFence(content) {
  return content.replace(/```/g, "` ` `");
}

function extractModelsFromPrismaSchema(schemaText) {
  const modelMatches = [...schemaText.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)];
  return modelMatches.map((match) => match[1]);
}

function extractEnumsFromPrismaSchema(schemaText) {
  const enumMatches = [...schemaText.matchAll(/^enum\s+([A-Za-z0-9_]+)\s*\{/gm)];
  return enumMatches.map((match) => match[1]);
}

function toSnakeCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function collectApiRoutes(textFiles) {
  const apiFiles = textFiles.filter(
    (file) => file.path.startsWith("src/app/api/") && file.path.endsWith("/route.ts")
  );

  return apiFiles
    .map((file) => {
      const routePath = `/${file.path
        .replace(/^src\/app\//, "")
        .replace(/\/route\.ts$/, "")
        .replace(/index$/, "")}`;

      const methods = [];
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const pattern = new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\(`);
        if (pattern.test(file.content)) {
          methods.push(method);
        }
      }

      const auth = file.content.includes("isAuthorized(")
        ? "Basic認証"
        : file.content.includes("isCronAuthorized") || file.content.includes("CRON_SECRET")
        ? "Bearer(CRON_SECRET)"
        : "不要";

      const idempotency =
        file.path === "src/app/api/reservations/route.ts"
          ? "重複候補検出あり（Idempotency-Keyは未採用）"
          : /Idempotency-Key/i.test(file.content)
          ? "Idempotency-Key対応"
          : "明示実装なし";

      const failClosedHints = [];
      if (file.content.includes("enforceWriteRequestSecurity")) {
        failClosedHints.push("CSRF/CORS/Content-Type防御");
      }
      if (file.content.includes("apiError(401")) {
        failClosedHints.push("未認証遮断");
      }
      if (file.content.includes("ensureReservationSchemaReady")) {
        failClosedHints.push("Schema未準備時503");
      }
      if (file.content.includes("evaluateReservationAvailability")) {
        failClosedHints.push("空席/締切/休業 fail-closed");
      }

      return {
        path: routePath,
        methods,
        auth,
        idempotency,
        failClosed: failClosedHints.join(" / ") || "実装ファイル要確認",
        source: file.path,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeApiPattern(value) {
  return value
    .replace(/\[[^\]]+\]/g, ":param")
    .replace(/:[A-Za-z0-9_]+/g, ":param")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function evaluateRequiredApiCoverage(implementedApis) {
  const implementedPatterns = new Map();

  for (const api of implementedApis) {
    for (const method of api.methods) {
      const key = `${method} ${normalizeApiPattern(api.path)}`;
      implementedPatterns.set(key, api.path);
    }
  }

  const fallbackMap = new Map([
    ["GET /api/v1/public/availability", "/api/availability"],
    ["POST /api/v1/public/reservations", "/api/reservations"],
    ["GET /api/v1/admin/reservations", "/api/admin/reservations"],
    ["POST /api/v1/admin/availability/block", "/api/admin/private-block"],
  ]);

  return REQUIRED_API_CANDIDATES.map((required) => {
    const [method, ...pathParts] = required.split(" ");
    const requiredPath = pathParts.join(" ").trim();

    if (!requiredPath || !method.match(/^(GET|POST|PUT|PATCH|DELETE)$/)) {
      return {
        required,
        status: "未実装",
        evidence: "該当API未確認",
      };
    }

    const key = `${method} ${normalizeApiPattern(requiredPath)}`;
    const matched = implementedPatterns.get(key);
    if (matched) {
      return {
        required,
        status: "実装済み",
        evidence: matched,
      };
    }

    const fallback = fallbackMap.get(required);
    if (fallback) {
      return {
        required,
        status: "未実装（現行互換あり）",
        evidence: `現行API: ${fallback}`,
      };
    }

    return {
      required,
      status: "未実装",
      evidence: "該当API未確認",
    };
  });
}

function collectScriptStatus(packageJsonText) {
  let parsed = null;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch {
    return [];
  }

  const scripts = parsed.scripts ?? {};
  const targets = [
    "npm run check",
    "npm test",
    "npm run lint",
    "npm run build",
    "npm run test:e2e",
    "npm run test:smoke",
    "npm run deploy:check",
    "npm run production:validate",
  ];

  return targets.map((command) => {
    const scriptName = command.replace(/^npm\s+run\s+/, "").replace(/^npm\s+/, "");
    const exists = Object.prototype.hasOwnProperty.call(scripts, scriptName);
    return {
      command,
      status: exists ? "定義あり（今回レポート生成時は未実行）" : "未定義",
      script: exists ? scripts[scriptName] : "-",
    };
  });
}

function summarizeTestGuarantee(filePath) {
  const base = path.basename(filePath);
  const key = base.toLowerCase();

  if (key.includes("reservation-capacity")) return "席パターン制約・定員判定の整合を検証";
  if (key.includes("reservations-route-db")) return "予約APIのDB整合/競合制御を検証";
  if (key.includes("reservations-route")) return "予約APIレスポンス/バリデーションを検証";
  if (key.includes("reservation-integration")) return "予約導線の統合シナリオを検証";
  if (key.includes("api-security")) return "書き込みAPIのセキュリティヘッダ/同一オリジン制約を検証";
  if (key.includes("cron-auth")) return "cron APIのBearer認証強制を検証";
  if (key.includes("basic-auth")) return "Basic認証判定を検証";
  if (key.includes("env-validation")) return "環境変数バリデーションを検証";
  if (key.includes("email-delivery")) return "メール送信失敗時fail-closed挙動を検証";
  if (key.includes("private-block")) return "貸切アクセス制御/DB整合を検証";
  if (key.includes("validation")) return "入力スキーマ検証を検証";
  if (key.includes("order")) return "オンラインストア注文状態遷移を検証";
  return "ユニット/回帰テスト";
}

function buildFeatureStatusRows(context) {
  const has = (relativePath) => context.allPathsSet.has(relativePath);

  return [
    ["トップページ", "実装済み", has("src/app/page.tsx") ? "src/app/page.tsx" : "未確認"],
    ["店舗紹介", "実装済み", has("src/app/page.tsx") ? "src/app/page.tsx" : "未確認"],
    ["メニュー / コース掲載", "実装済み", has("src/lib/reservation-config.ts") ? "src/lib/reservation-config.ts" : "未確認"],
    ["営業時間表示", "実装済み", "src/lib/reservation-config.ts"],
    ["アクセス表示", "実装済み", "src/app/access/page.tsx"],
    ["予約フォーム", "実装済み", "src/components/reserve-form.tsx"],
    ["予約枠選択", "実装済み", "src/lib/booking-rules.ts"],
    ["人数選択", "実装済み", "src/components/reserve-form.tsx"],
    ["日付選択", "実装済み", "src/components/reserve-form.tsx"],
    ["時間帯選択", "実装済み", "src/components/reserve-form.tsx"],
    ["コース選択", "実装済み", "src/lib/reservation-config.ts"],
    ["顧客情報入力", "実装済み", "src/components/reserve-form.tsx"],
    ["電話番号入力", "実装済み", "src/components/reserve-form.tsx"],
    ["メールアドレス入力", "未実装", "予約フォームにはemail項目なし"],
    ["アレルギー/要望入力", "実装済み", "src/components/reserve-form.tsx(note)"],
    ["予約確認画面", "未実装", "単一画面送信（確認ステップなし）"],
    ["予約完了画面", "実装済み", "src/components/reserve-form.tsx(result表示)"],
    ["予約完了メール", "外部検証待ち", "src/lib/email.ts（店舗通知は実装、顧客完了メール未確認）"],
    ["店舗向け通知", "実装済み", "src/lib/email.ts#sendReservationEmail"],
    ["顧客向けリマインド", "外部検証待ち", "src/app/api/crons/remind/route.ts（LINE送信未実装）"],
    ["キャンセル導線", "実装済み", "管理画面操作 + 電話案内"],
    ["予約変更導線", "未実装", "顧客セルフ変更UIなし"],
    ["管理画面", "実装済み", "src/app/admin/reservations/page.tsx"],
    ["予約一覧", "実装済み", "src/app/admin/reservations/page.tsx"],
    ["当日予約一覧", "実装済み", "dateパラメータで当日表示可能"],
    ["翌日準備リスト", "未実装", "専用UI/API未確認"],
    ["空席・席数管理", "実装済み", "src/lib/reservation-capacity.ts"],
    ["営業日 / 定休日管理", "実装済み", "src/app/admin/business-days/page.tsx"],
    ["臨時休業管理", "実装済み", "BusinessDay.isClosed"],
    ["貸切ブロック", "実装済み", "src/app/api/admin/private-block/route.ts"],
    ["キャンセル待ち", "未実装", "待機キュー未確認"],
    ["No-show記録", "実装済み", "ReservationStatus.NOSHOW + 管理画面更新"],
    ["CSV/export", "未実装", "公開API/管理UIに専用export未確認"],
    ["Google Calendar連携", "未実装", "連携実装未確認"],
    ["メール/SMS/LINE通知", "外部検証待ち", "メール実装済み、SMS未実装、LINEは準備のみ"],
    ["Docker / systemd / nginx", "未実装", "該当設定ファイル未確認"],
    ["production validation evidence", "実証リリース準備済み", "docs/production-launch.md"],
    ["実機スマホ確認", "外部検証待ち", "tmp-*.png証跡はあるが実地再確認推奨"],
    ["実予約フロー確認", "外部検証待ち", "本番相当の最新再実行が必要"],
    ["通知到達確認", "外部検証待ち", "メール/LINE到達の最新証跡が必要"],
    ["店舗スタッフ運用訓練", "外部検証待ち", "手順書はあるが訓練ログ未確認"],
  ];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(text) {
  let output = escapeHtml(text);

  output = output.replace(/`([^`]+)`/g, (_match, code) => `<code>${escapeHtml(code)}</code>`);
  output = output.replace(/\*\*([^*]+)\*\*/g, (_match, strong) => `<strong>${strong}</strong>`);
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    const safeHref = escapeHtml(href);
    return `<a href="${safeHref}">${escapeHtml(label)}</a>`;
  });

  return output;
}

function markdownTableRowToCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return null;
  }

  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparatorRow(line) {
  const cells = markdownTableRowToCells(line);
  if (!cells) return false;
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function markdownToHtml(markdownText) {
  const lines = markdownText.replace(/\r\n/g, "\n").split("\n");
  const html = [];

  let inCode = false;
  let codeLines = [];
  let listMode = null;
  let tableLines = [];

  const closeList = () => {
    if (listMode === "ul") html.push("</ul>");
    if (listMode === "ol") html.push("</ol>");
    listMode = null;
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;

    if (tableLines.length >= 2 && isTableSeparatorRow(tableLines[1])) {
      const header = markdownTableRowToCells(tableLines[0]) ?? [];
      const body = tableLines.slice(2).map((line) => markdownTableRowToCells(line) ?? []);

      html.push("<table>");
      html.push("<thead><tr>");
      for (const cell of header) {
        html.push(`<th>${renderInlineMarkdown(cell)}</th>`);
      }
      html.push("</tr></thead>");
      html.push("<tbody>");
      for (const row of body) {
        html.push("<tr>");
        for (const cell of row) {
          html.push(`<td>${renderInlineMarkdown(cell)}</td>`);
        }
        html.push("</tr>");
      }
      html.push("</tbody>");
      html.push("</table>");
    } else {
      for (const line of tableLines) {
        html.push(`<p>${renderInlineMarkdown(line)}</p>`);
      }
    }

    tableLines = [];
  };

  for (const line of lines) {
    if (inCode) {
      if (line.startsWith("```")) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (line.startsWith("```")) {
      closeList();
      flushTable();
      inCode = true;
      codeLines = [];
      continue;
    }

    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      closeList();
      tableLines.push(line);
      continue;
    }

    flushTable();

    if (!line.trim()) {
      closeList();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeList();
      html.push("<hr>");
      continue;
    }

    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      if (listMode !== "ul") {
        closeList();
        html.push("<ul>");
        listMode = "ul";
      }
      html.push(`<li>${renderInlineMarkdown(bulletMatch[1])}</li>`);
      continue;
    }

    const orderedMatch = /^\d+\.\s+(.*)$/.exec(line);
    if (orderedMatch) {
      if (listMode !== "ol") {
        closeList();
        html.push("<ol>");
        listMode = "ol";
      }
      html.push(`<li>${renderInlineMarkdown(orderedMatch[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeList();
  flushTable();

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  return html.join("\n");
}

function inferBinaryPurpose(relativePath) {
  const lower = relativePath.toLowerCase();

  if (/public\/photos\/料理\//.test(relativePath)) return "料理写真";
  if (/public\/photos\/外装\//.test(relativePath)) return "店舗外観写真";
  if (/public\/photos\/内装\//.test(relativePath)) return "店舗内装写真";
  if (/public\/photos\/icons\//.test(relativePath)) return "アイコン素材";
  if (/favicon|apple-icon|icon\.png/.test(lower)) return "サイトアイコン";
  if (/tmp-.*\.(png|jpg|jpeg)$/.test(lower)) return "検証スクリーンショット";
  if (/\.pdf$/.test(lower)) return "PDFメニューまたは参考資料";
  if (/\.odg$/.test(lower)) return "デザイン原稿";
  if (/\.woff|\.ttf|\.otf/.test(lower)) return "フォント";
  return "静的バイナリ資産";
}

function buildRequiredModelCoverage(actualModels) {
  const actualSnake = new Set(actualModels.map((model) => toSnakeCase(model)));

  return EXPECTED_DB_TABLES.map((table) => {
    const matched = actualSnake.has(table) || actualSnake.has(table.replace(/s$/, ""));

    if (matched) {
      const candidate = actualModels.find((model) => toSnakeCase(model) === table) ??
        actualModels.find((model) => toSnakeCase(model) === table.replace(/s$/, "")) ??
        "(モデル名差分あり)";
      return {
        table,
        status: "実装あり",
        evidence: candidate,
      };
    }

    return {
      table,
      status: "未実装/未確認",
      evidence: "prisma/schema.prisma で該当モデル未確認",
    };
  });
}

function makeMarkdownReport(context) {
  const {
    generatedAt,
    data,
    apiRoutes,
    requiredApiCoverage,
    modelCoverage,
    prismaModels,
    prismaEnums,
    testScriptStatus,
    testFiles,
    fileTree,
    pdfMeta,
  } = context;

  const projectRoot = ROOT;
  const scannedFiles = data.scannedFileCount;
  const listedTextFiles = data.textFiles.length;
  const listedBinaryFiles = data.binaryFiles.length;
  const excludedFiles = data.excludedFiles.length;
  const excludedDirs = data.excludedDirectories.reduce((sum, row) => sum + row.fileCount, 0);
  const totalExcludedCount = excludedFiles + excludedDirs;

  const implementedApiRows = apiRoutes.map((api) => [
    api.path,
    api.methods.join(", "),
    api.auth,
    api.idempotency,
    api.failClosed,
    api.source,
  ]);

  const requiredApiRows = requiredApiCoverage.map((row) => [row.required, row.status, row.evidence]);

  const featureRows = buildFeatureStatusRows({
    allPathsSet: new Set([
      ...data.textFiles.map((file) => file.path),
      ...data.binaryFiles.map((file) => file.path),
    ]),
  });

  const modelRows = modelCoverage.map((row) => [row.table, row.status, row.evidence]);

  const scriptRows = testScriptStatus.map((row) => [row.command, row.status, row.script]);

  const testRows = testFiles.map((file) => [file.path, summarizeTestGuarantee(file.path)]);

  const excludedRows = [
    ...data.excludedDirectories.map((row) => [
      `${row.path}/**`,
      `${row.fileCount.toLocaleString("en-US")} files`,
      row.reason,
    ]),
    ...data.excludedFiles.map((row) => [
      row.path,
      bytesLabel(row.size),
      row.reason,
    ]),
  ];

  const inventoryRows = data.inventoryRows.map((row, index) => [
    String(index + 1),
    row.path,
    row.type,
    row.type === "excluded_dir" ? `${row.size.toLocaleString("en-US")} files` : bytesLabel(row.size),
    row.sha256,
    row.role,
    row.importance,
    row.relatedSections,
    row.placement,
  ]);

  const binaryRows = data.binaryFiles.map((file) => [
    file.path,
    bytesLabel(file.size),
    file.extension,
    file.sha256,
    inferBinaryPurpose(file.path),
    "一覧のみ（必要画像のみサムネイル候補）",
  ]);

  const appendixEntries = data.textFiles.map((file) => {
    const safeContent = file.path === "package-lock.json" ? `${file.content.slice(0, 120000)}\n\n[TRUNCATED_FOR_REPORT_PERFORMANCE]` : file.content;
    return [
      "---",
      `File: ${file.path}`,
      `Bytes: ${file.size}`,
      `Encoding: ${file.encoding}`,
      `SHA256: ${file.sha256}`,
      `Role: ${file.role}`,
      `Related Sections: ${file.relatedSections}`,
      "Content:",
      "```text",
      safeCodeFence(safeContent),
      "```",
      "",
    ].join("\n");
  });

  const unreadableList = data.unreadableFiles.length
    ? data.unreadableFiles.map((row) => `- ${row.path}: ${row.error}`).join("\n")
    : "- なし";
  const pdfSizeDisplay = pdfMeta ? `${pdfMeta.size.toLocaleString("en-US")} bytes` : "生成後に追記";
  const pdfPageDisplay = pdfMeta ? String(pdfMeta.pages) : "生成後に追記";

  const section00 = `# ${PDF_TITLE}

## 0. 表紙

- PDFタイトル: ${PDF_TITLE}
- 対象プロジェクト名: ${PROJECT_NAME}
- 店舗名: ${STORE_NAME}
- 対象ルートパス: ${projectRoot}
- 作成日時: ${generatedAt}
- 生成者: ${GENERATOR}
- 注意書き:
  - このPDFはプロジェクトフォルダの内容に基づく
  - 外部検証が必要な項目は「未検証」と明記する
  - 店舗運用・法務・個人情報保護・キャンセルポリシーは専門家または店舗責任者確認が必要
  - ファイルに書かれていないことは断定せず、推測は推測と明記する

## 目次

1. エグゼクティブサマリー
2. プロジェクトの目的と事業定義
3. 現在のプロダクト状態
4. アーキテクチャ全体像
5. 主要フロー
6. 状態遷移
7. データモデル / DB設計
8. API仕様
9. 予約UI / モバイル導線 / 顧客体験
10. 管理画面 / スタッフ権限 / 店舗運用
11. セキュリティ / 個人情報 / 秘密情報管理
12. 本番配備 / インフラ / 運用
13. 法務 / APPI / キャンセルポリシー / 承認ゲート
14. テスト / 検証 / Evidence
15. ファイルツリー
16. ファイル別インベントリ
17. 重要ファイル別解説
18. 未完了・外部検証待ち一覧
19. リスクと対策
20. 次にやるべきこと
21. 付録A: 全テキストファイル内容
22. 付録B: バイナリファイル一覧
23. 付録C: 生成ログ`;

  const section01 = `## 1. エグゼクティブサマリー

**このプロダクトは、Next.js + Prismaで実装された「予約受付 + 店舗運用管理」基盤であり、公開予約導線・空席判定・管理画面・貸切制御・通知導線を備えた Reservation Ops / Guest Experience Layer です。**

- 主な対象ユーザー:
  - 予約する顧客（公開予約フォーム）
  - 店舗スタッフ（\`/staff\`）
  - 店舗責任者（\`/admin/reservations\`, \`/admin/business-days\`）
  - 外部運用協力者（復旧runbook/運用docs参照）
- 現在の完成度:
  - コア予約導線と管理画面は**実装済み**
  - v1 API分離、顧客セルフ変更、通知ワーカー本実装は**未実装または未検証**
- Go/No-Go上の残課題:
  - 顧客向け完了通知/リマインドの本番到達証跡
  - 店舗運用訓練（当日/翌日オペレーション）
  - 法務/店舗責任者承認（privacy/cancellation/APPI）
- 事業上・店舗運用上の勝ち筋:
  - スマホ完結予約の離脱を抑えつつ、貸切/休業/電話導線を fail-closed で統制
- 最重要リスク:
  - PIIを含む復旧証跡ファイルの取り扱い
  - 予約重複/競合時の運用誤解
- 本番公開前に絶対に確認すべきこと:
  - 実機スマホ予約の end-to-end
  - 満席・休業・締切の拒否挙動
  - 通知到達
  - backup/restore 手順の再現`;

  const section02 = `## 2. プロジェクトの目的と事業定義

- ゴール:
  - 顧客が迷わず予約完了でき、店舗が当日運用まで管理できる予約運用OSを提供
- 対象顧客:
  - 来店予約客（スマホ中心）
- 想定利用シーン:
  - 通常予約、貸切設定、休業日設定、当日オペレーション確認
- ${STORE_NAME} にとっての価値:
  - 予約枠・貸切・休業・特記事項を一元管理
- 顧客にとっての価値:
  - 営業時間・枠条件を満たす予約のみ受理される安心感
- 店舗スタッフにとっての価値:
  - 当日一覧・貸切解除・ステータス更新を1画面導線で処理
- なぜ単なる予約フォームではないか:
  - \`evaluateReservationAvailability\` と管理画面運用が統合され、予約後運用まで繋がるため
- 価値の定義:
  - 「予約できる」だけでなく「予約後に店舗と顧客が困らない」こと
- 予約サイトが担うべき業務範囲（実装/未実装混在）:
  - 予約受付, 空席確認, 人数/時間帯/コース選択, 特別要望受付, 予約確認, キャンセル運用, リマインド準備, 店舗オペ連携`;

  const section03 = `## 3. 現在のプロダクト状態

${makeMarkdownTable(["項目", "分類", "根拠"], featureRows)}`;

  const section04 = `## 4. アーキテクチャ全体像

Customer Browser / Mobile
  -> Public Reservation Web (\`/booking\`)
  -> Reservation API (\`/api/reservations\`)
  -> Availability Engine (\`src/lib/reservation-capacity.ts\`)
  -> Reservation DB (Prisma/PostgreSQL)
  -> Notification (\`src/lib/email.ts\`, cron remind placeholder)

Staff Browser
  -> Staff Hub (\`/staff\`)
  -> Admin Console (\`/admin/reservations\`, \`/admin/business-days\`)
  -> Admin APIs (\`/api/admin/*\`)
  -> Reservation DB

Server boundary
  -> Next.js App Router + Route Handlers
  -> API security layer (\`src/lib/api-security.ts\`)
  -> Basic auth middleware (\`src/middleware.ts\`, \`src/lib/basic-auth.ts\`)

Operations boundary
  -> docs/production-launch.md
  -> scripts/check-release-safety.mjs
  -> scripts/security/*

外部サービス
- Email: Resend / SendGrid（実装あり）
- LINE: env準備あり、送信本体は未実装
- SMS: 未実装
- Google Calendar: 未実装
- Map: フロント表示あり
- Analytics: 明示実装未確認
- Payment/deposit: 予約用途では未実装（オンラインストア側は別実装）

明記事項:
- 顧客は予約入力のみで管理権限は持たない
- 店舗スタッフは確認・変更・キャンセル・来店状況管理を行う
- サーバーは予約/空席/通知/運用制御を担当
- 個人情報を扱うため、ログ・PDF・エクスポートではマスク方針が必要
- 外部連携は実装済み（Email）と未検証/未実装（LINE/SMS/Calendar）を分離して扱う`;

  const section05 = `## 5. 主要フロー

### 5.1 顧客予約フロー

1. 顧客が \`/booking\` にアクセス
2. 日付/人数/時間帯/コースを選択
3. 氏名・電話番号・要望を入力
4. \`POST /api/reservations\` へ送信
5. サーバーで \`enforceWriteRequestSecurity\` + バリデーション + 空席判定
6. advisory lock + serializable transaction で競合制御
7. 予約確定後、店舗通知メール送信（非同期）
8. 管理画面へ反映

### 5.2 空席・予約枠管理フロー

1. 営業日/定休日/休業日を \`BusinessDay\` + config で確認
2. \`evaluateReservationAvailability\` が時間帯・人数・締切を判定
3. 同時予約は advisory lock + retry で制御
4. 予約確定で枠を実質消費（ledgerは予約テーブル）
5. キャンセル時は \`ReservationStatus.CANCELLED\` に更新して再度可用枠へ復帰
6. 貸切は \`ReservationType.PRIVATE_BLOCK\` で反映

### 5.3 店舗管理フロー

1. Basic認証で管理画面アクセス
2. 予約一覧/日次状況を確認
3. 貸切設定/解除、予約ステータス更新
4. No-showは \`NOSHOW\` ステータスで記録
5. 監査相当はログ + private block auditで追跡

### 5.4 通知フロー

- 予約完了メール: 顧客向けは未確認、店舗通知は実装
- 店舗向け新規予約通知: 実装済み
- 予約変更通知: 未実装
- キャンセル通知: 未実装（運用電話前提）
- 前日/当日リマインド: cronエンドポイントあり、LINE送信未実装
- retry/dead-letter: 明示的なキュー/死信箱は未実装
- 通知ログ: アプリログで失敗記録

### 5.5 例外処理フロー

- 営業時間外/定休日/満席/人数超過: \`availabilityReasonToError\` でfail-closed
- 予約重複: duplicate window検知
- 仮押さえTTL: 未実装
- 完了直前競合: serializable + retry
- メール不達: ログ記録（予約確定とは分離）
- 変更期限/キャンセル期限: 明示ポリシーAPIは未実装
- 大人数/貸切相談: PHONE_ONLY / PRIVATE_BLOCK へ誘導

### 5.6 キャンセル / 変更 / No-show フロー

- 顧客: 電話導線
- 店舗: 管理画面から \`PATCH /api/admin/reservations/[id]\`
- ステータス: CONFIRMED -> CANCELLED / DONE / NOSHOW
- 空席復元: CANCELLED扱いで可用性計算から除外
- 監査: private block解除時のみ監査テーブル、一般予約はアプリログ中心
- 事前決済/返金: 予約機能として未実装

### 5.7 日次締め / 店舗運用フロー

- \`/staff\` で当日営業状態確認
- \`/admin/reservations\` で当日一覧確認
- 貸切/休業設定は \`/admin/business-days\`
- 翌日準備リスト専用画面: 未実装（将来課題）`;

  const section06 = `## 6. 状態遷移

### reservation

- 実装状態: CONFIRMED, CANCELLED, DONE, NOSHOW
- 要求状態との差分:
${makeMarkdownTable(
  ["要求状態", "実装状況", "備考"],
  [
    ["draft", "未実装", "作成直後確定モデル"],
    ["held", "未実装", "仮押さえTTL未実装"],
    ["confirmed", "実装済み", "CONFIRMED"],
    ["change_requested", "未実装", "変更要求キューなし"],
    ["changed", "未実装", "変更履歴状態なし"],
    ["cancelled_by_customer", "未実装", "顧客セルフキャンセルなし"],
    ["cancelled_by_store", "部分実装", "CANCELLEDに集約"],
    ["expired", "未実装", "期限失効状態なし"],
    ["seated", "未実装", "DONEで代替運用"],
    ["completed", "部分実装", "DONE相当"],
    ["no_show", "実装済み", "NOSHOW"],
    ["review_required", "未実装", "レビューケース管理なし"],
  ]
)}

### availability

- 実装状態: OK, PHONE_ONLY, PRIVATE_BLOCK, CLOSED, CUTOFF_PASSED, BEFORE_OPENING, SAME_DAY_BLOCKED, OUT_OF_RANGE, INVALID_DATE
- 要求状態(open/limited/full/blocked/closed/temporarily_closed)とは命名差分あり。\`PHONE_ONLY\` / \`PRIVATE_BLOCK\` が blocked系に相当。

### notification

- 実装状態: 成功/失敗（関数戻り値 + ログ）
- pending/sent/failed/retrying/dead_letter の永続状態管理は未実装

### review

- open/assigned/approved/rejected/resolved のレビュー状態管理は未実装

強調ポイント:
- confirmed後の重複予約は duplicate window + lockで抑制
- expired/cancelled を自動で confirmedへ戻す実装はなし
- キャンセル期限後 review_required 送出は未実装
- 大人数/貸切は PHONE_ONLY/PRIVATE_BLOCK で自動確定を避ける
- 同一 idempotency key の1回処理は予約APIでは未実装（注文API側に存在）
- 通知失敗は予約確定と分離
- 空席更新は予約状態に整合`;

  const section07 = `## 7. データモデル / DB設計

実装モデル（Prisma）:
- ${prismaModels.join(", ")}

実装enum（Prisma）:
- ${prismaEnums.join(", ")}

要求テーブルカバレッジ:
${makeMarkdownTable(["要求テーブル", "状況", "証跡"], modelRows)}

補足:
- reservation-first availability ledger: \`Reservation\` + \`reservation-capacity\` ロジック
- 予約枠/席数/人数を整数で扱う理由: 判定ロジックを離散化し競合判定を単純化
- 日時/タイムゾーン: \`Asia/Tokyo\` ベース
- 営業日とカレンダー日付: \`BusinessDay\` と config の二層
- 席のみ予約とコース予約: course値で区別
- 仮押さえTTL: 未実装
- idempotency: 予約は重複候補検知、明示key未採用
- audit log hash chain: 未実装
- SQLite前提: 現実装は PostgreSQL 前提（Prisma datasource）
- PostgreSQL/MySQL移行論点: enum/transaction/advisory lock互換性
- PII保持: DB保存あり。保持期間/削除運用は法務・店舗判断が必要`;

  const section08 = `## 8. API仕様

### 実装API一覧

${makeMarkdownTable(
  ["Path", "Method", "認証", "Idempotency", "重要fail-closed条件", "実装ファイル"],
  implementedApiRows
)}

### 要求API対応状況

${makeMarkdownTable(["要求API", "判定", "補足"], requiredApiRows)}

API共通整理:
- 目的: 予約受付、空席照会、管理更新、cron運用
- 認証: 公開APIは無認証、管理APIはBasic、cronはBearer
- 入力: JSON + zod validation
- 出力: JSON（\`error\`/\`code\`/\`fields\`整備）
- 状態遷移影響: 予約作成/キャンセル/来店済み/No-show
- 監査ログ対象: private block監査はDB、その他はログ中心
- idempotency: 予約APIは重複候補検知、key方式は未採用
- PII含有: 予約作成・管理取得はPIIを含む
- rate limit: 予約作成APIにIPベース制限実装`;

  const section09 = `## 9. 予約UI / モバイル導線 / 顧客体験

- トップページから予約導線: \`/\` -> \`/booking\`
- CTA文言: 予約導線リンクと予約ボタン
- モバイルファースト設計: \`ReserveForm\` にモバイル最適UI
- 日付/時間帯/人数/コース選択UI: 実装済み
- 予約確認画面: 未実装（入力→即送信）
- 予約完了表示: 実装済み（送信後summary表示）
- 予約番号表示: reservationIdはAPI返却するがUI表示は限定的
- 予約完了メール: 店舗通知中心、顧客向け完了メールは未確認
- アクセス情報/営業時間/定休日表示: 実装済み
- キャンセルポリシー表示: 文言はあるが独立ポリシー実装は未確認
- 個人情報同意: 明示同意UIは未確認
- アレルギー・特別要望入力: note欄で受け付け
- エラー表示: APIエラー/通信タイムアウト表示あり
- 入力途中離脱対策: 明示実装未確認
- 予約枠埋まり表示: PHONE_ONLY/不可理由表示
- 満席時代替候補: 自動候補提示は未実装
- JS無効時対応: 明示実装未確認
- 電話予約fallback: 実装済み（電話案内）
- SNS/GBP/Instagram導線: 参照実装は未確認
- SEO/OGP/structured data: 基本構造はあるが本番検証待ち
- アクセシビリティ: 基本ラベルは実装、総合監査は未実施
- 多言語対応: 未実装

明記:
- 顧客に不要な入力（email等）は現状最小化されている
- 重要条件（締切/電話案内）を表示
- 予約完了後に日時・人数・コース・連絡先が分かる
- 店舗名 \`${STORE_NAME}\` の表示は主要画面に存在
- 住所・営業時間・ポリシーの情報源は \`src/app/*\` と \`src/lib/reservation-config.ts\``;

  const section10 = `## 10. 管理画面 / スタッフ権限 / 店舗運用

- staff / manager / admin の厳密RBAC: 未実装（Basic認証ベース）
- session TTL: Basic認証のため明示session TTLなし
- password policy: \`ADMIN_BASIC_USER/PASS\` 依存
- PIN lockout: 未実装
- 予約閲覧/変更/キャンセル/No-show: 管理APIで実装
- 空席ブロック/営業日変更: 実装
- コース設定変更: コード設定中心
- 顧客メモ閲覧: 実装
- 個人情報閲覧権限分離: 未実装
- CSV/export権限: 未実装
- two-person rule 対象操作: 未実装
- 店舗スタッフが迷わない導線: \`/staff\` ハブで集約
- 当日営業で最も見る画面: \`/admin/reservations?date=YYYY-MM-DD\`
- 翌日準備で最も見る画面: 現状は同画面日付切替で代替`;

  const section11 = `## 11. セキュリティ / 個人情報 / 秘密情報管理

- 環境変数で確認される主要secret:
  - APP_SECRET, SESSION_SECRET, CSRF_SECRET: **コード上は専用key未実装**
  - ADMIN_PASSWORD: \`ADMIN_BASIC_PASS\` として管理
  - EMAIL_API_KEY / RESEND_API_KEY: 実装あり
  - SMS_API_KEY: 未実装
  - LINE_CHANNEL_SECRET: env定義あり
  - WEBHOOK_SECRET / METRICS_SECRET: 未実装
- 本番で弱いsecret拒否: \`env.ts\` の必須チェックはあるが強度検査は限定的
- CORS/CSRF/XSS/SQLi/rate limit:
  - CORS/CSRF: \`enforceWriteRequestSecurity\`
  - SQLi: Prisma使用 + 一部raw query注意
  - rate limit: 予約書き込みAPIで実装
- bot/spam/replay guard:
  - IP rate limitあり
  - CAPTCHA/高度bot対策は未実装
- idempotency:
  - 予約APIは重複候補検知
  - 注文APIはIdempotency-Key
- audit log:
  - private block監査ログテーブルあり
  - 予約全操作の専用監査台帳は未実装
- backup encryption/access log PII漏洩:
  - recovery資料にPIIを含むため運用統制が必要
- robots/sitemap/noindex:
  - 個別設定は要確認

PDFマスク方針:
- secret/API key/token/password/DB接続情報はマスク
- 顧客氏名・電話・メール・住所・要望はマスク
- 高リスク復旧証跡は強マスク掲載`;

  const section12 = `## 12. 本番配備 / インフラ / 運用

- Dockerfile: 未確認
- docker-compose.prod.yml: 未確認
- systemd service: 未確認
- nginx config: 未確認
- TLS/HTTPS: Vercel前提（docsあり）
- healthcheck: 専用 \`healthz\`/\`readyz\` は未実装
- backup/restore: \`docs/recovery/*\` と scripts/recovery あり
- deployment scripts: \`scripts/check-release-safety.mjs\`, \`docs/production-launch.md\`
- production validation evidence: docsに記録あり
- restore drill: docsに手順あり
- smoke test: production-launchに記載
- audit chain verification: hash chain未実装
- GitHub Actions CI: \`.github/workflows/*\` で lint/test/build/security
- cron/worker: \`vercel.json\` + \`/api/crons/*\`
- メール送信設定: env + \`src/lib/email.ts\`
- DB migration: \`prisma/migrations/*\`
- monitoring/alerting: 明示実装は限定的（ログ中心）
- rollback手順: runbook記載（Vercel deploy rollback）`;

  const section13 = `## 13. 法務 / APPI / キャンセルポリシー / 承認ゲート

プロジェクト文書上の確認項目:
- privacy policy: \`/privacy\` 実装あり
- terms of use: 独立ページ未確認
- cancellation policy: 明示ページ未確認（電話案内中心）
- no-show policy: 明示ページ未確認
- allergy disclaimer: note運用はあるが免責文言は要確認
- cookie/analytics policy: 未確認
- Google Maps/外部埋め込み確認: 要確認
- 写真/メニュー/価格表示確認: 運用確認が必要

専門家/店舗責任者判断が必要な項目:
- APPI適合性の最終判断
- 個人情報保存期間と削除請求オペレーション
- データ処理委託先の適法性確認
- cancellation/no-show policy の最終承認
- 店舗責任者approval ref / 法務approval ref の記録化

※本章は法的断定を行わず、確認項目の整理に留める。`;

  const section14 = `## 14. テスト / 検証 / Evidence

### コマンド定義状況

${makeMarkdownTable(["コマンド", "状況", "内容"], scriptRows)}

### テストファイル一覧と保証内容

${makeMarkdownTable(["テストファイル", "主な保証"], testRows)}

### 検証状況

- production validation evidence: docs上の記載あり
- external validation pending: あり
- 実機スマホ検証: 最新実地再検証が必要
- 実予約フロー検証: 本番相当の再検証が必要
- メール通知到達確認: 要再検証
- SMS/LINE通知到達確認: SMS未実装、LINE未実装
- 管理画面操作確認: 実装あり、運用訓練証跡は要補完
- 予約重複防止確認: ロジック/テストあり
- 満席時受付停止確認: ロジック/テストあり
- キャンセル導線確認: 管理画面導線あり
- Google Calendar連携確認: 未実装
- public FQDN/TLS確認: 本番環境で要確認
- store ops drill: 実施証跡は要確認`;

  const section15 = `## 15. ファイルツリー

~~~text
${fileTree}
~~~

### 除外ファイル一覧（理由付き）

${makeMarkdownTable(["path", "size", "reason"], excludedRows)}`;

  const section16 = `## 16. ファイル別インベントリ

${makeMarkdownTable(
  [
    "No",
    "path",
    "種別",
    "サイズ",
    "SHA256",
    "役割",
    "重要度",
    "関連章",
    "PDF内掲載方法",
  ],
  inventoryRows
)}`;

  const section17 = `## 17. 重要ファイル別解説

### ドキュメント

- README.md: システム概要/運用方針。予約+ストア同居構成を説明。
- docs/production-launch.md: 本番手順とスモークチェック。
- docs/system-design-review-prep.md: 設計レビュー観点。
- docs/reservation-control-guide.md: 店舗運用手順。
- docs/recovery/*: 復旧手順と証跡（PII含有のため取扱注意）。

### ソースコード

- src/app/api/reservations/route.ts: 予約作成、競合制御、重複検知、通知起点。
- src/lib/reservation-capacity.ts: 空席判定の中核。
- src/lib/booking-rules.ts: 営業日/締切/時間帯ルール。
- src/lib/email.ts: 通知送信とfail-closed挙動。
- src/lib/api-security.ts: 書き込みAPI防御。

### フロントエンド

- src/app/booking/page.tsx: 初期値/可用性取得を含む予約ページ。
- src/components/reserve-form.tsx: モバイル予約導線の中心。
- src/app/page.tsx: トップ導線。
- src/app/admin/reservations/page.tsx: 店舗運用UI。

### テスト

- tests/reservation-capacity.test.ts: 空席ロジック回帰。
- tests/reservations-route*.test.ts: API挙動。
- tests/api-security.test.ts: CORS/CSRF防御。
- tests/cron-auth.test.ts: cron認証。

### デプロイ・運用

- .github/workflows/*.yml: CIでlint/test/build/securityを実施。
- scripts/check-release-safety.mjs: リリース前env検査。
- scripts/security/*: セキュリティガード。
- scripts/recovery/*: バックアップ/復旧補助。`;

  const section18 = `## 18. 未完了・外部検証待ち一覧

### 実装済みだが外部証跡待ち

- 実機スマホ予約確認
- 実メール通知到達確認
- LINE通知到達確認（実装後）
- 公開TLSホスト確認
- 店舗スタッフ運用訓練
- 予約重複防止の本番相当検証
- 満席時受付停止検証
- 権限分離運用検証
- SEO/OGP本番確認

### 実装として未完了

- キャンセル待ち
- 多言語対応
- 事前決済 / デポジット（予約機能）
- SMS通知
- LINE通知本送信
- Google Calendar同期
- 詳細RBAC
- CSV/export
- 顧客セルフ予約変更
- reviewケース管理

### 法務・店舗承認待ち

- privacy policy 最終承認
- APPI確認
- cancellation/no-show policy
- allergy disclaimer
- terms of use
- cookie / analytics policy
- 店舗責任者approval ref
- 法務approval ref
- 価格・メニュー表示確認
- 写真利用許諾確認`;

  const section19 = `## 19. リスクと対策

${makeMarkdownTable(
  ["リスク", "発生条件", "影響", "現在の対策", "残課題", "優先度"],
  [
    ["個人情報漏洩", "復旧証跡/ログの取り扱い不備", "信用失墜・法務リスク", "マスク方針/権限制御", "保存期間・削除運用", "P0"],
    ["予約重複", "高同時アクセス", "オーバーブッキング", "advisory lock + serializable + duplicate検知", "本番負荷試験", "P0"],
    ["満席誤受付", "ロジック欠陥/運用ミス", "現場混乱", "capacity判定 + PHONE_ONLY", "本番相当検証", "P0"],
    ["営業時間外受付", "入力改ざん/バグ", "運用破綻", "booking-rules fail-closed", "E2E証跡", "P0"],
    ["アレルギー見落とし", "note運用不備", "重大事故", "メモ表示", "必須確認フロー", "P0"],
    ["通知不達", "外部メール障害", "来店トラブル", "送信失敗ログ", "retry/dead-letter未実装", "P1"],
    ["管理画面不正アクセス", "認証情報漏洩", "改ざん", "Basic認証", "IP制限/MFA未実装", "P0"],
    ["DB障害", "クラウド障害", "予約停止", "runbook/backup", "復旧訓練継続", "P0"],
    ["SQLite運用限界", "将来拡張", "性能/整合性課題", "現在PostgreSQL", "多店舗向け再設計", "P2"],
    ["スマホUX不備", "入力離脱", "予約率低下", "モバイルUI最適化", "離脱計測改善", "P1"],
  ]
)}`;

  const section20 = `## 20. 次にやるべきこと

### P0: 本番公開前に必須

- 技術: build/test/lint、実予約、重複防止、満席停止、通知到達、HTTPS、backup/restore、secret強度
- 店舗運用: 受付ルール、営業時間、コース/人数制限、キャンセルポリシー、当日運用訓練
- 法務/個人情報: privacy/APPI/cancellation/cookie/保存期間の確定
- デザイン/UX: スマホ表示、入力分かりやすさ、完了画面、店舗情報整合

### P1: 本番公開直後に改善

- 予約完了率/離脱分析
- 通知失敗分析
- 管理画面UX改善
- 変更/キャンセル導線改善
- FAQ拡充

### P2: 運用安定後に拡張

- キャンセル待ち
- LINE/SMS通知
- Google Calendar同期
- CRM/来店履歴
- No-show分析
- 多言語対応
- 事前決済/デポジット

### P3: 事業展開・複数店舗展開

- 複数店舗対応
- 店舗別権限
- 横断レポート
- 外部予約媒体/POS/MA連携`;

  const section21 = `## 21. 付録A: 全テキストファイル内容

${appendixEntries.join("\n")}`;

  const section22 = `## 22. 付録B: バイナリファイル一覧

${makeMarkdownTable(
  ["path", "size", "extension", "SHA256", "推定用途", "PDF化時の扱い"],
  binaryRows
)}`;

  const section23 = `## 23. 付録C: 生成ログ

- 生成日時: ${generatedAt}
- 対象ルート: ${projectRoot}
- 走査ファイル数: ${scannedFiles}
- 掲載テキストファイル数: ${listedTextFiles}
- 一覧化したバイナリファイル数: ${listedBinaryFiles}
- 除外ファイル数: ${totalExcludedCount}
- マスク件数: ${data.maskCount}
- 生成スクリプト名: scripts/export-reservation-site-understanding-report.mjs
- 使用したライブラリ: node:fs, node:path, node:crypto, puppeteer
- エラーまたは読み取り不能ファイル:
${unreadableList}
- PDFファイルサイズ: ${pdfSizeDisplay}
- PDFページ数: ${pdfPageDisplay}`;

  return [
    section00,
    section01,
    section02,
    section03,
    section04,
    section05,
    section06,
    section07,
    section08,
    section09,
    section10,
    section11,
    section12,
    section13,
    section14,
    section15,
    section16,
    section17,
    section18,
    section19,
    section20,
    section21,
    section22,
    section23,
  ].join("\n\n");
}

function buildHtmlDocument(markdown, title) {
  const bodyHtml = markdownToHtml(markdown);

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 14mm 18mm 14mm;
    }

    body {
      font-family: "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif;
      color: #1f1f1f;
      line-height: 1.5;
      font-size: 10.5pt;
      word-break: break-word;
    }

    h1, h2, h3, h4 {
      line-height: 1.25;
      margin-top: 1.2em;
      margin-bottom: 0.5em;
      color: #111;
    }

    h1 { font-size: 18pt; border-bottom: 1px solid #ccc; padding-bottom: 0.2em; }
    h2 { font-size: 14pt; border-left: 4px solid #222; padding-left: 0.4em; }
    h3 { font-size: 12pt; }
    h4 { font-size: 11pt; }

    p, li {
      margin-top: 0.2em;
      margin-bottom: 0.2em;
    }

    ul, ol {
      margin-top: 0.2em;
      margin-bottom: 0.6em;
      padding-left: 1.3em;
    }

    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 9pt;
      background: #f4f4f4;
      border-radius: 3px;
      padding: 1px 4px;
    }

    pre {
      background: #f7f7f7;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 8px;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      word-break: break-word;
      page-break-inside: avoid;
      font-size: 8.4pt;
      line-height: 1.35;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.6em 0 1.2em;
      table-layout: fixed;
    }

    th, td {
      border: 1px solid #d6d6d6;
      padding: 4px 6px;
      vertical-align: top;
      font-size: 8.4pt;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    th {
      background: #f0f0f0;
      font-weight: 700;
    }

    hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 1.2em 0;
    }

    a {
      color: #0f4c81;
      text-decoration: none;
    }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

async function renderPdf(htmlContent, outputPdfPath) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    await page.pdf({
      path: outputPdfPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="font-size:8px;color:#666;width:100%;text-align:center;">' +
        'Page <span class="pageNumber"></span> / <span class="totalPages"></span>' +
        "</div>",
      margin: {
        top: "14mm",
        right: "10mm",
        bottom: "14mm",
        left: "10mm",
      },
    });
  } finally {
    await browser.close();
  }
}

function countPdfPages(buffer) {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 0;
}

async function main() {
  const generatedAt = formatDateTimeJst();
  const dateStamp = formatDateStampJst();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const markdownOutputPath = path.join(
    OUTPUT_DIR,
    `reservation_site_full_understanding_report_${dateStamp}.md`
  );
  const pdfOutputPath = path.join(
    OUTPUT_DIR,
    `reservation_site_full_understanding_report_${dateStamp}.pdf`
  );
  const logOutputPath = path.join(
    OUTPUT_DIR,
    `reservation_site_full_understanding_report_generation_log_${dateStamp}.txt`
  );

  const data = collectFiles(ROOT);

  const prismaSchema = data.textFiles.find((file) => file.path === "prisma/schema.prisma")?.content ?? "";
  const packageJsonText = data.textFiles.find((file) => file.path === "package.json")?.content ?? "{}";

  const prismaModels = extractModelsFromPrismaSchema(prismaSchema);
  const prismaEnums = extractEnumsFromPrismaSchema(prismaSchema);
  const apiRoutes = collectApiRoutes(data.textFiles);
  const requiredApiCoverage = evaluateRequiredApiCoverage(apiRoutes);
  const modelCoverage = buildRequiredModelCoverage(prismaModels);
  const testScriptStatus = collectScriptStatus(packageJsonText);
  const testFiles = data.textFiles.filter((file) => file.path.startsWith("tests/"));

  const treePaths = [
    ...data.textFiles.map((file) => file.path),
    ...data.binaryFiles.map((file) => file.path),
    ...data.excludedFiles.map((file) => file.path),
  ];
  const fileTree = buildTree(treePaths, data.excludedDirectories);

  let reportMeta = null;
  let stable = false;
  let pdfBuffer = Buffer.alloc(0);

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const markdown = makeMarkdownReport({
      generatedAt,
      dateStamp,
      data,
      apiRoutes,
      requiredApiCoverage,
      modelCoverage,
      prismaModels,
      prismaEnums,
      testScriptStatus,
      testFiles,
      fileTree,
      pdfMeta: reportMeta,
    });

    fs.writeFileSync(markdownOutputPath, markdown, "utf8");
    const html = buildHtmlDocument(markdown, PDF_TITLE);
    await renderPdf(html, pdfOutputPath);

    pdfBuffer = fs.readFileSync(pdfOutputPath);
    const producedMeta = {
      size: pdfBuffer.length,
      pages: countPdfPages(pdfBuffer),
    };

    if (
      reportMeta &&
      reportMeta.size === producedMeta.size &&
      reportMeta.pages === producedMeta.pages
    ) {
      reportMeta = producedMeta;
      stable = true;
      break;
    }

    reportMeta = producedMeta;
  }

  if (!stable && reportMeta) {
    const markdown = makeMarkdownReport({
      generatedAt,
      dateStamp,
      data,
      apiRoutes,
      requiredApiCoverage,
      modelCoverage,
      prismaModels,
      prismaEnums,
      testScriptStatus,
      testFiles,
      fileTree,
      pdfMeta: reportMeta,
    });
    fs.writeFileSync(markdownOutputPath, markdown, "utf8");
    const html = buildHtmlDocument(markdown, PDF_TITLE);
    await renderPdf(html, pdfOutputPath);
    pdfBuffer = fs.readFileSync(pdfOutputPath);
    reportMeta = {
      size: pdfBuffer.length,
      pages: countPdfPages(pdfBuffer),
    };
  }

  const pdfPageCount = reportMeta?.pages ?? countPdfPages(pdfBuffer);
  const pdfSize = reportMeta?.size ?? pdfBuffer.length;

  const totalExcludedCount =
    data.excludedFiles.length + data.excludedDirectories.reduce((sum, row) => sum + row.fileCount, 0);

  const logLines = [
    `GeneratedAtJST: ${generatedAt}`,
    `ProjectRoot: ${ROOT}`,
    `ScannedFileCount: ${data.scannedFileCount}`,
    `TextFilesListed: ${data.textFiles.length}`,
    `BinaryFilesListed: ${data.binaryFiles.length}`,
    `ExcludedFileCount: ${totalExcludedCount}`,
    `MaskCount: ${data.maskCount}`,
    `UnreadableFiles: ${data.unreadableFiles.length}`,
    `GeneratorScript: scripts/export-reservation-site-understanding-report.mjs`,
    `Libraries: node:fs,node:path,node:crypto,puppeteer`,
    `PdfPath: ${pdfOutputPath}`,
    `PdfSizeBytes: ${pdfSize}`,
    `PdfPages: ${pdfPageCount}`,
    `MarkdownPath: ${markdownOutputPath}`,
    `LogPath: ${logOutputPath}`,
    "UnreadableFileDetails:",
    ...(data.unreadableFiles.length
      ? data.unreadableFiles.map((row) => `- ${row.path}: ${row.error}`)
      : ["- none"]),
  ];

  fs.writeFileSync(logOutputPath, `${logLines.join("\n")}\n`, "utf8");

  const reportSummary = {
    pdfOutputPath,
    markdownOutputPath,
    logOutputPath,
    pdfPageCount,
    pdfSize,
    scannedFileCount: data.scannedFileCount,
    listedTextFileCount: data.textFiles.length,
    listedBinaryFileCount: data.binaryFiles.length,
    excludedFileCount: totalExcludedCount,
    maskCount: data.maskCount,
    unreadableFileCount: data.unreadableFiles.length,
  };

  process.stdout.write(`${JSON.stringify(reportSummary, null, 2)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[report-export] failed: ${message}\n`);
  process.exit(1);
});
