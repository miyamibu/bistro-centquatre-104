import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional()).catch(undefined);

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
    STORE_NAME: z.string().min(1).default("Bistro 104"),
    LINE_CHANNEL_ACCESS_TOKEN: optionalString,
    LINE_CHANNEL_SECRET: optionalString,
    LIFF_ID: optionalString,
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,
    CRON_SECRET: optionalString,
    BACKUP_EXPORT_SECRET: optionalString,
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
  return !!(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_CHANNEL_SECRET && env.LIFF_ID);
}
