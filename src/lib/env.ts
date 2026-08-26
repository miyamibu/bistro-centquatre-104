import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional()).catch(undefined);
function parseStrictOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return undefined;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

const strictOptionalBoolean = z.preprocess(
  (value) => {
    const parsed = parseStrictOptionalBoolean(value);
    return parsed === undefined && typeof value === "string" && value.trim() !== ""
      ? value
      : parsed;
  },
  z.boolean().optional()
);

function isBuildTimeValidationBypass() {
  return (
    process.env.npm_lifecycle_event === "build" ||
    process.env.NEXT_PHASE === "phase-production-build"
  );
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: optionalString,
    BASE_URL: optionalUrl,
    STORE_NOTIFY_EMAIL: optionalEmail,
    EMAIL_PROVIDER: z.enum(["resend", "sendgrid"]).optional(),
    EMAIL_API_KEY: optionalString,
    EMAIL_FROM: optionalEmail,
    RESEND_API_KEY: optionalString,
    ADMIN_EMAIL: optionalEmail,
    STORE_NAME: z.string().min(1).default("bistro centquatre 104"),
    LINE_CHANNEL_ACCESS_TOKEN: optionalString,
    LINE_CHANNEL_SECRET: optionalString,
    LINE_LOGIN_CHANNEL_ID: optionalString,
    // Deprecated: use NEXT_PUBLIC_LIFF_BOOKING_ID / NEXT_PUBLIC_LIFF_LINK_ID instead.
    NEXT_PUBLIC_LIFF_ID: optionalString,
    NEXT_PUBLIC_LIFF_BOOKING_ID: optionalString,
    NEXT_PUBLIC_LIFF_LINK_ID: optionalString,
    LINE_LINK_TOKEN_PEPPER: optionalString,
    LINE_PHONE_AUTO_ATTACH_ENABLED: strictOptionalBoolean.default(false),
    LINE_RESERVATION_LOOKUP_LINK_ENABLED: strictOptionalBoolean.default(false),
    LINE_MONTHLY_REMINDER_LIMIT: z.coerce.number().int().positive().optional(),
    LINE_MONTHLY_REMINDER_WARN_THRESHOLD: z.coerce.number().int().positive().optional(),
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    CRON_SECRET: optionalString,
    BACKUP_EXPORT_SECRET: optionalString,
    RATE_LIMIT_HASH_SECRET: optionalString,
    RESERVATION_TOKEN_SECRET: optionalString,
    RESERVATION_TOKEN_KEYS_JSON: optionalString,
    RESERVATION_TOKEN_ACTIVE_KEY_ID: optionalString,
    BACKUP_ENCRYPTION_KEY: optionalString,
    BACKUP_ENCRYPTION_KEY_ID: optionalString,
    BACKUP_ENCRYPTION_KEYS_JSON: optionalString,
    BACKUP_ENCRYPTION_ACTIVE_KEY_ID: optionalString,
    STAFF_SESSION_MAX_AGE_SECONDS: z.coerce.number().int().min(900).max(86400).default(28800),
    PRIVATE_BLOCK_ACCESS_CODE: optionalString,
    BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY: optionalString,
    BANK_ACCOUNT_HISTORY_KEY_VERSION: z.coerce.number().int().positive().optional().default(1),
    CONTACT_PHONE_E164: z
      .preprocess(emptyToUndefined, z.string().regex(/^\+?[1-9]\d{7,14}$/).optional())
      .default("+81492706897"),
    CONTACT_PHONE_DISPLAY: z
      .preprocess(emptyToUndefined, z.string().min(1).optional())
      .default("049－270－6897"),
    CONTACT_MESSAGE: z
      .preprocess(emptyToUndefined, z.string().min(1).optional())
      .default("お電話でお問い合わせください"),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production" || isBuildTimeValidationBypass()) return;

    const requiredInProduction: Array<keyof typeof value> = [
      "DATABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "CRON_SECRET",
      "BACKUP_EXPORT_SECRET",
      "RATE_LIMIT_HASH_SECRET",
      "BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY",
    ];

    for (const key of requiredInProduction) {
      if (!value[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "is required in production",
        });
      }
    }

    if (
      value.RATE_LIMIT_HASH_SECRET &&
      (value.RATE_LIMIT_HASH_SECRET.length < 32 ||
        /^(change-?me|dummy|test|placeholder|replace-with)/i.test(value.RATE_LIMIT_HASH_SECRET))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RATE_LIMIT_HASH_SECRET"],
        message: "must be a non-placeholder value of at least 32 characters in production",
      });
    }

    const tokenPlaceholder = /^(change-?me|dummy|test|placeholder|replace-with)/i;
    const tokenKeyringRaw = value.RESERVATION_TOKEN_KEYS_JSON?.trim();
    if (tokenKeyringRaw) {
      let parsedKeyring: unknown;
      try {
        parsedKeyring = JSON.parse(tokenKeyringRaw);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["RESERVATION_TOKEN_KEYS_JSON"],
          message: "must be valid JSON in production",
        });
        parsedKeyring = null;
      }

      if (
        parsedKeyring === null ||
        typeof parsedKeyring !== "object" ||
        Array.isArray(parsedKeyring)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["RESERVATION_TOKEN_KEYS_JSON"],
          message: "must be a JSON object of key id to secret in production",
        });
      } else {
        const entries = Object.entries(parsedKeyring as Record<string, unknown>);
        if (entries.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["RESERVATION_TOKEN_KEYS_JSON"],
            message: "must contain at least one key in production",
          });
        }
        for (const [keyId, secret] of entries) {
          if (
            !keyId ||
            typeof secret !== "string" ||
            secret.trim().length < 32 ||
            tokenPlaceholder.test(secret.trim())
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["RESERVATION_TOKEN_KEYS_JSON"],
              message: `key ${keyId || "<empty>"} must be a non-placeholder value of at least 32 characters`,
            });
          }
        }
        const activeKeyId = value.RESERVATION_TOKEN_ACTIVE_KEY_ID?.trim();
        if (!activeKeyId || !(parsedKeyring as Record<string, unknown>)[activeKeyId]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["RESERVATION_TOKEN_ACTIVE_KEY_ID"],
            message: "must reference a key in RESERVATION_TOKEN_KEYS_JSON",
          });
        }
      }
    } else if (
      !value.RESERVATION_TOKEN_SECRET ||
      value.RESERVATION_TOKEN_SECRET.length < 32 ||
      tokenPlaceholder.test(value.RESERVATION_TOKEN_SECRET)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESERVATION_TOKEN_SECRET"],
        message:
          "RESERVATION_TOKEN_KEYS_JSON with active key or a non-placeholder RESERVATION_TOKEN_SECRET of at least 32 characters is required in production",
      });
    }

    const backupKeyringRaw = value.BACKUP_ENCRYPTION_KEYS_JSON?.trim();
    if (backupKeyringRaw) {
      let parsedBackupKeyring: unknown;
      try {
        parsedBackupKeyring = JSON.parse(backupKeyringRaw);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["BACKUP_ENCRYPTION_KEYS_JSON"],
          message: "must be valid JSON in production",
        });
        parsedBackupKeyring = null;
      }
      if (
        parsedBackupKeyring === null ||
        typeof parsedBackupKeyring !== "object" ||
        Array.isArray(parsedBackupKeyring)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["BACKUP_ENCRYPTION_KEYS_JSON"],
          message: "must be a JSON object of key id to secret in production",
        });
      } else {
        const entries = Object.entries(parsedBackupKeyring as Record<string, unknown>);
        const activeKeyId = value.BACKUP_ENCRYPTION_ACTIVE_KEY_ID?.trim();
        if (entries.length === 0 || !activeKeyId || !(parsedBackupKeyring as Record<string, unknown>)[activeKeyId]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["BACKUP_ENCRYPTION_ACTIVE_KEY_ID"],
            message: "must reference a key in BACKUP_ENCRYPTION_KEYS_JSON",
          });
        }
        for (const [keyId, secret] of entries) {
          if (
            !keyId ||
            typeof secret !== "string" ||
            secret.trim().length < 32 ||
            tokenPlaceholder.test(secret.trim())
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["BACKUP_ENCRYPTION_KEYS_JSON"],
              message: `key ${keyId || "<empty>"} must be a non-placeholder value of at least 32 characters`,
            });
          }
        }
      }
    } else if (
      !value.BACKUP_ENCRYPTION_KEY ||
      value.BACKUP_ENCRYPTION_KEY.length < 32 ||
      tokenPlaceholder.test(value.BACKUP_ENCRYPTION_KEY)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BACKUP_ENCRYPTION_KEY"],
        message:
          "BACKUP_ENCRYPTION_KEYS_JSON with active key or a non-placeholder BACKUP_ENCRYPTION_KEY of at least 32 characters is required in production",
      });
    }

    // Runtime LINE handlers fail closed for missing secrets; the shared env parser must not
    // crash unrelated routes when optional LINE rollout values are partially configured.
    if (value.LINE_LINK_TOKEN_PEPPER && value.LINE_LINK_TOKEN_PEPPER.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LINE_LINK_TOKEN_PEPPER"],
        message: "must be at least 32 characters in production",
      });
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join(", ");
  throw new Error(`Invalid environment variables: ${issues}`);
}

export const env = parsedEnv.data;

export function hasLineMessagingEnv(): boolean {
  return !!env.LINE_CHANNEL_ACCESS_TOKEN;
}

export function hasLineLoginEnv(): boolean {
  return !!env.LINE_LOGIN_CHANNEL_ID;
}

export function hasLineWebhookEnv(): boolean {
  return !!env.LINE_CHANNEL_SECRET;
}

export function getLineLoginChannelId(): string | undefined {
  return env.LINE_LOGIN_CHANNEL_ID;
}

export function getLineChannelAccessToken(): string | undefined {
  return env.LINE_CHANNEL_ACCESS_TOKEN;
}

export function getLineChannelSecret(): string | undefined {
  return env.LINE_CHANNEL_SECRET;
}

export function isLinePhoneAutoAttachEnabled(): boolean {
  // Kept only for backwards-compatible environment parsing. A phone number
  // alone is not ownership proof, so this path is intentionally fail-closed
  // until a verified ownership flow exists.
  return false;
}

export function isLineReservationLookupLinkEnabled(): boolean {
  // Lookup by date/phone/name is not an ownership proof and cannot enable a
  // reservation link, even if an old deployment flag is still present.
  return false;
}
