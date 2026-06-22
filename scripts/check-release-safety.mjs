import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const repoRoot = process.cwd();
const mode = process.argv[2] ?? "local-build";
const supportedModes = new Set(["local-build", "preview", "production"]);

if (!supportedModes.has(mode)) {
  console.error(
    `Unsupported mode: ${mode}. Use one of: ${Array.from(supportedModes).join(", ")}.`,
  );
  process.exit(1);
}

const requiredKeys = [
  "DATABASE_URL",
  "BASE_URL",
  "ADMIN_BASIC_USER",
  "ADMIN_BASIC_PASS",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "BACKUP_EXPORT_SECRET",
  "RATE_LIMIT_HASH_SECRET",
  "BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY",
];

const recommendedKeys = [
  "BANK_ACCOUNT_HISTORY_KEY_VERSION",
  "CONTACT_PHONE_E164",
  "CONTACT_PHONE_DISPLAY",
  "CONTACT_MESSAGE",
  "NEXT_PUBLIC_CONTACT_PHONE_E164",
  "NEXT_PUBLIC_CONTACT_PHONE_DISPLAY",
  "NEXT_PUBLIC_CONTACT_MESSAGE",
  "STORE_NOTIFY_EMAIL",
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
  "ADMIN_EMAIL",
  "STORE_NAME",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_CHANNEL_SECRET",
  // LIFF_ID (旧名) は廃止。NEXT_PUBLIC_LIFF_BOOKING_ID / NEXT_PUBLIC_LIFF_LINK_ID を使う。
  "NEXT_PUBLIC_LIFF_BOOKING_ID",
  "NEXT_PUBLIC_LIFF_LINK_ID",
  "LINE_LINK_TOKEN_PEPPER",
];

const placeholderMarkers = [
  "placeholder",
  "changeme",
  "your-",
  "your_",
  "<real",
  "<your-",
  "replace-with",
  "dummy-",
  "example.supabase.co",
  "example.com",
];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const envMap = {};
  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    value = value.replace(/\s+#.*$/, "").trim();
    if (key) {
      envMap[key] = value;
    }
  }

  return envMap;
}

function resolveEnv() {
  const merged = {
    ...parseEnvFile(path.join(repoRoot, ".env")),
    ...parseEnvFile(path.join(repoRoot, ".env.local")),
  };

  for (const key of [...requiredKeys, ...recommendedKeys, "EMAIL_API_KEY", "RESEND_API_KEY"]) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim() !== "") {
      merged[key] = value.trim();
    }
  }

  return merged;
}

function isPlaceholder(value) {
  if (!value || value.trim() === "") {
    return true;
  }

  const normalized = value.toLowerCase();
  return placeholderMarkers.some((marker) => normalized.includes(marker));
}

function isValidRateLimitHashSecret(value) {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    !/^(change-?me|dummy|test|placeholder|replace-with)/i.test(value)
  );
}

function getGitAuthorEmail() {
  try {
    return execSync("git config user.email", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function printSection(title) {
  console.log(`\n==> ${title}`);
}

const envMap = resolveEnv();
const missingRequired = requiredKeys.filter((key) => !envMap[key] || envMap[key].trim() === "");
const enforceRealSecrets = mode !== "local-build";
const placeholderRequired = enforceRealSecrets
  ? requiredKeys.filter((key) => envMap[key] && isPlaceholder(envMap[key]))
  : [];
const invalidRequired = [];
if (enforceRealSecrets && envMap.RATE_LIMIT_HASH_SECRET && !isValidRateLimitHashSecret(envMap.RATE_LIMIT_HASH_SECRET)) {
  invalidRequired.push("RATE_LIMIT_HASH_SECRET must be a non-placeholder value of at least 32 characters");
}
const missingRecommended = recommendedKeys.filter((key) => !envMap[key] || envMap[key].trim() === "");

printSection(`Release safety check (${mode})`);
console.log(`Repository: ${repoRoot}`);

if (missingRequired.length > 0) {
  console.error(`Missing required env keys: ${missingRequired.join(", ")}`);
}

if (placeholderRequired.length > 0) {
  console.error(`Required env keys still look like placeholders: ${placeholderRequired.join(", ")}`);
} else if (!enforceRealSecrets) {
  console.log("Local-build mode allows placeholder-like values as long as required keys are present.");
}

if (invalidRequired.length > 0) {
  console.error(`Invalid required env values: ${invalidRequired.join(", ")}`);
}

if (missingRecommended.length > 0) {
  console.warn(`Recommended env keys are unset: ${missingRecommended.join(", ")}`);
}

const gitAuthorEmail = getGitAuthorEmail();
if (!gitAuthorEmail) {
  console.warn("Git author email is not configured. CLI preview deploys can fail on Vercel team projects.");
} else if (gitAuthorEmail.endsWith(".local") || gitAuthorEmail.includes("@localhost")) {
  console.warn(
    `Git author email looks local-only (${gitAuthorEmail}). CLI preview deploys can fail unless this email has Vercel team access.`,
  );
}

if (mode === "preview") {
  console.warn(
    "Preview deploy also needs the same required keys configured in Vercel Preview environment. Local values alone do not satisfy Vercel build-time checks.",
  );
}

if (mode === "production") {
  console.warn(
    "Before production deploy, confirm the same required keys are set in Vercel Production and point to the intended live services.",
  );
}

if (missingRequired.length > 0 || placeholderRequired.length > 0 || invalidRequired.length > 0) {
  process.exit(1);
}

console.log("Required env checks passed.");
