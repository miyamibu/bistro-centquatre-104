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
    ADMIN_BASIC_USER: optionalString,
    ADMIN_BASIC_PASS: optionalString,
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
      "ADMIN_BASIC_USER",
      "ADMIN_BASIC_PASS",
      "NEXT_PUBLIC_SUPABASE_URL",
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
  return (
    parseStrictOptionalBoolean(process.env.LINE_PHONE_AUTO_ATTACH_ENABLED) ??
    env.LINE_PHONE_AUTO_ATTACH_ENABLED
  ) === true;
}

export function isLineReservationLookupLinkEnabled(): boolean {
  return (
    parseStrictOptionalBoolean(process.env.LINE_RESERVATION_LOOKUP_LINK_ENABLED) ??
    env.LINE_RESERVATION_LOOKUP_LINK_ENABLED
  ) === true;
}
