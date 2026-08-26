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

const baseRequiredKeys = [
  "DATABASE_URL",
  "BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STAFF_SESSION_MAX_AGE_SECONDS",
  "CRON_SECRET",
  "BACKUP_EXPORT_SECRET",
  "RATE_LIMIT_HASH_SECRET",
  "BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY",
  "LINE_LINK_TOKEN_PEPPER",
];

const deploymentRequiredKeys = [
  "DIRECT_URL",
  "NEXT_PUBLIC_APP_URL",
  "PRODUCTION_HOST_PROVIDER",
  "STORE_NOTIFY_EMAIL",
  "EMAIL_PROVIDER",
  "EMAIL_FROM",
];

const requiredKeys =
  mode === "local-build"
    ? baseRequiredKeys
    : [...baseRequiredKeys, ...deploymentRequiredKeys];

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
  "RESERVATION_TOKEN_KEYS_JSON",
  "RESERVATION_TOKEN_ACTIVE_KEY_ID",
  "BACKUP_ENCRYPTION_KEYS_JSON",
  "BACKUP_ENCRYPTION_ACTIVE_KEY_ID",
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

  const keysToResolve = new Set([
    ...baseRequiredKeys,
    ...deploymentRequiredKeys,
    ...recommendedKeys,
    "EMAIL_API_KEY",
    "RESEND_API_KEY",
    "RESERVATION_TOKEN_SECRET",
    "RESERVATION_TOKEN_KEYS_JSON",
    "RESERVATION_TOKEN_ACTIVE_KEY_ID",
    "BACKUP_ENCRYPTION_KEY",
    "BACKUP_ENCRYPTION_KEY_ID",
    "BACKUP_ENCRYPTION_KEYS_JSON",
    "BACKUP_ENCRYPTION_ACTIVE_KEY_ID",
    "VERCEL_CONFIG_PATH",
    "NEXT_PUBLIC_APP_URL",
    "PRODUCTION_HOST_PROVIDER",
  ]);

  for (const key of keysToResolve) {
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

function isValidStrongSecret(value) {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    !/^(change-?me|dummy|test|placeholder|replace-with)/i.test(value)
  );
}

function validateKeyring(rawKeyring, activeKeyId, label, requireRealValue) {
  if (!rawKeyring || rawKeyring.trim() === "") return [];

  let parsed;
  try {
    parsed = JSON.parse(rawKeyring);
  } catch {
    return [`${label} must be valid JSON`];
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [`${label} must be a JSON object of key id to secret`];
  }

  const errors = [];
  const entries = Object.entries(parsed);
  if (entries.length === 0) errors.push(`${label} must contain at least one key`);
  if (!activeKeyId || typeof parsed[activeKeyId] !== "string") {
    errors.push(`${label} active key id must reference a key in ${label}`);
  }
  for (const [keyId, secret] of entries) {
    if (!isValidStrongSecret(secret)) {
      errors.push(`${label}.${keyId} must be a non-placeholder value of at least 32 characters`);
    } else if (requireRealValue && isPlaceholder(secret)) {
      errors.push(`${label}.${keyId} still looks like a placeholder`);
    }
  }
  return errors;
}

function hasUsableEmailApiKey(value, requireRealValue) {
  if (typeof value !== "string" || value.trim() === "") {
    return false;
  }

  return !requireRealValue || !isPlaceholder(value);
}

function validateEmailConfiguration(envMap, requireCompleteConfiguration) {
  const errors = [];
  const rawProvider = envMap.EMAIL_PROVIDER?.trim() ?? "";

  if (!requireCompleteConfiguration && rawProvider === "") {
    return errors;
  }

  for (const key of ["EMAIL_PROVIDER", "STORE_NOTIFY_EMAIL", "EMAIL_FROM"]) {
    if (!envMap[key] || envMap[key].trim() === "") {
      errors.push(`${key} is required when mail delivery is enabled`);
    }
  }

  if (rawProvider === "") {
    return errors;
  }

  const provider = rawProvider.toLowerCase();
  if (provider === "resend") {
    const hasResendKey = hasUsableEmailApiKey(
      envMap.RESEND_API_KEY,
      requireCompleteConfiguration,
    );
    const hasFallbackKey = hasUsableEmailApiKey(
      envMap.EMAIL_API_KEY,
      requireCompleteConfiguration,
    );
    if (!hasResendKey && !hasFallbackKey) {
      errors.push("EMAIL_PROVIDER=resend requires RESEND_API_KEY or EMAIL_API_KEY");
    }
    return errors;
  }

  if (provider === "sendgrid") {
    if (!hasUsableEmailApiKey(envMap.EMAIL_API_KEY, requireCompleteConfiguration)) {
      errors.push("EMAIL_PROVIDER=sendgrid requires EMAIL_API_KEY");
    }
    return errors;
  }

  errors.push("EMAIL_PROVIDER must be either resend or sendgrid");
  return errors;
}

function readVercelCronConfig(envMap) {
  const configPath =
    envMap.VERCEL_CONFIG_PATH?.trim() || path.join(repoRoot, "vercel.json");

  if (!fs.existsSync(configPath)) {
    return { configPath: null, highFrequencyCrons: [] };
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    return {
      configPath,
      error: `vercel.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      highFrequencyCrons: [],
    };
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {
      configPath,
      error: "vercel.json must contain a JSON object",
      highFrequencyCrons: [],
    };
  }

  if (config.crons !== undefined && !Array.isArray(config.crons)) {
    return {
      configPath,
      error: "vercel.json crons must be an array",
      highFrequencyCrons: [],
    };
  }

  const highFrequencyCrons = (config.crons ?? []).filter((entry) => {
    if (!entry || typeof entry.path !== "string" || typeof entry.schedule !== "string") {
      return false;
    }

    const fields = entry.schedule.trim().split(/\s+/);
    const minuteStep = /^\*\/(\d+)$/.exec(fields[0] ?? "");
    return (
      fields.length === 5 &&
      minuteStep !== null &&
      Number(minuteStep[1]) > 0 &&
      Number(minuteStep[1]) <= 5 &&
      fields.slice(1).every((field) => field === "*")
    );
  });

  return { configPath, highFrequencyCrons };
}

function validateVercelCronPlan(envMap) {
  const cronConfig = readVercelCronConfig(envMap);
  if (cronConfig.error) {
    return [cronConfig.error];
  }

  if (cronConfig.highFrequencyCrons.length === 0) {
    return [];
  }

  const cronDescription = cronConfig.highFrequencyCrons
    .map((entry) => `${entry.path} (${entry.schedule})`)
    .join(", ");
  return [
    `High-frequency Vercel Cron is forbidden because Vercel must remain Hobby: ${cronDescription}`,
  ];
}

function validateDeploymentEmailProvider(mode, envMap) {
  if (mode === "local-build") return [];
  return envMap.EMAIL_PROVIDER?.trim().toLowerCase() === "resend"
    ? []
    : [
        "EMAIL_PROVIDER must be resend for Preview/Production provider idempotency; SendGrid remains local-only",
      ];
}

function validateProductionHost(mode, envMap) {
  if (mode === "local-build") return [];

  const errors = [];
  const provider = envMap.PRODUCTION_HOST_PROVIDER?.trim().toLowerCase() ?? "";
  if (provider !== "netlify") {
    errors.push(
      "PRODUCTION_HOST_PROVIDER must be netlify for the approved free commercial deployment",
    );
  }

  let baseUrl;
  let publicUrl;
  try {
    baseUrl = new URL(envMap.BASE_URL ?? "");
  } catch {
    errors.push("BASE_URL must be a valid URL");
  }
  try {
    publicUrl = new URL(envMap.NEXT_PUBLIC_APP_URL ?? "");
  } catch {
    errors.push("NEXT_PUBLIC_APP_URL must be a valid URL");
  }

  for (const [label, url] of [
    ["BASE_URL", baseUrl],
    ["NEXT_PUBLIC_APP_URL", publicUrl],
  ]) {
    if (url && url.protocol !== "https:") {
      errors.push(`${label} must use HTTPS for ${mode}`);
    }
    if (url && url.hostname.endsWith(".vercel.app")) {
      errors.push(`${label} must not point commercial production traffic to Vercel Hobby`);
    }
  }

  if (baseUrl && publicUrl && baseUrl.origin !== publicUrl.origin) {
    errors.push("BASE_URL and NEXT_PUBLIC_APP_URL must use the same origin");
  }

  return errors;
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
const enforceRealSecrets = mode !== "local-build";
const missingRequired = requiredKeys.filter((key) => !envMap[key] || envMap[key].trim() === "");
if (
  (!envMap.RESERVATION_TOKEN_KEYS_JSON || !envMap.RESERVATION_TOKEN_ACTIVE_KEY_ID) &&
  (!envMap.RESERVATION_TOKEN_SECRET || envMap.RESERVATION_TOKEN_SECRET.trim() === "")
) {
  missingRequired.push(
    "RESERVATION_TOKEN_KEYS_JSON + RESERVATION_TOKEN_ACTIVE_KEY_ID (or RESERVATION_TOKEN_SECRET)",
  );
}
if (
  (!envMap.BACKUP_ENCRYPTION_KEYS_JSON || !envMap.BACKUP_ENCRYPTION_ACTIVE_KEY_ID) &&
  (!envMap.BACKUP_ENCRYPTION_KEY || envMap.BACKUP_ENCRYPTION_KEY.trim() === "")
) {
  missingRequired.push(
    "BACKUP_ENCRYPTION_KEYS_JSON + BACKUP_ENCRYPTION_ACTIVE_KEY_ID (or BACKUP_ENCRYPTION_KEY)",
  );
}
const placeholderRequired = enforceRealSecrets
  ? requiredKeys.filter((key) => envMap[key] && isPlaceholder(envMap[key]))
  : [];
const invalidRequired = [];
if (enforceRealSecrets && envMap.RATE_LIMIT_HASH_SECRET && !isValidStrongSecret(envMap.RATE_LIMIT_HASH_SECRET)) {
  invalidRequired.push("RATE_LIMIT_HASH_SECRET must be a non-placeholder value of at least 32 characters");
}
if (
  enforceRealSecrets &&
  envMap.RESERVATION_TOKEN_SECRET &&
  !isValidStrongSecret(envMap.RESERVATION_TOKEN_SECRET)
) {
  invalidRequired.push(
    "RESERVATION_TOKEN_SECRET must be a non-placeholder value of at least 32 characters",
  );
}
if (enforceRealSecrets && envMap.BACKUP_ENCRYPTION_KEY && !isValidStrongSecret(envMap.BACKUP_ENCRYPTION_KEY)) {
  invalidRequired.push(
    "BACKUP_ENCRYPTION_KEY must be a non-placeholder value of at least 32 characters",
  );
}
invalidRequired.push(
  ...validateKeyring(
    envMap.RESERVATION_TOKEN_KEYS_JSON,
    envMap.RESERVATION_TOKEN_ACTIVE_KEY_ID,
    "RESERVATION_TOKEN_KEYS_JSON",
    enforceRealSecrets,
  ),
  ...validateKeyring(
    envMap.BACKUP_ENCRYPTION_KEYS_JSON,
    envMap.BACKUP_ENCRYPTION_ACTIVE_KEY_ID,
    "BACKUP_ENCRYPTION_KEYS_JSON",
    enforceRealSecrets,
  ),
);
if (enforceRealSecrets && envMap.STAFF_SESSION_MAX_AGE_SECONDS) {
  const maxAge = Number(envMap.STAFF_SESSION_MAX_AGE_SECONDS);
  if (!Number.isInteger(maxAge) || maxAge < 900 || maxAge > 86400) {
    invalidRequired.push("STAFF_SESSION_MAX_AGE_SECONDS must be an integer between 900 and 86400");
  }
}
const emailConfigurationErrors = validateEmailConfiguration(envMap, enforceRealSecrets);
const vercelCronErrors = validateVercelCronPlan(envMap);
const deploymentEmailProviderErrors = validateDeploymentEmailProvider(mode, envMap);
const productionHostErrors = validateProductionHost(mode, envMap);
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

if (emailConfigurationErrors.length > 0) {
  console.error(`Invalid mail configuration: ${emailConfigurationErrors.join("; ")}`);
}

if (deploymentEmailProviderErrors.length > 0) {
  console.error(`Invalid deployment mail provider: ${deploymentEmailProviderErrors.join("; ")}`);
}

if (vercelCronErrors.length > 0) {
  console.error(`Invalid Vercel Cron plan configuration: ${vercelCronErrors.join("; ")}`);
}

if (productionHostErrors.length > 0) {
  console.error(`Invalid production host configuration: ${productionHostErrors.join("; ")}`);
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
    "Preview deploy also needs the same required keys configured in the isolated Netlify environment. Local values alone do not satisfy build-time checks.",
  );
}

if (mode === "production") {
  console.warn(
    "Before production deploy, confirm the same required keys are set in Netlify Production and point to the intended live services.",
  );
}

if (
  missingRequired.length > 0 ||
  placeholderRequired.length > 0 ||
  invalidRequired.length > 0 ||
  emailConfigurationErrors.length > 0 ||
  deploymentEmailProviderErrors.length > 0 ||
  vercelCronErrors.length > 0 ||
  productionHostErrors.length > 0
) {
  process.exit(1);
}

console.log("Required env and mail configuration checks passed.");
