import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .preprocess(emptyToUndefined, z.string().url().optional())
    .catch(undefined),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  // Deprecated: prefer NEXT_PUBLIC_LIFF_BOOKING_ID / NEXT_PUBLIC_LIFF_LINK_ID.
  NEXT_PUBLIC_LIFF_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  NEXT_PUBLIC_LIFF_BOOKING_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  NEXT_PUBLIC_LIFF_LINK_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

// Next.js only inlines NEXT_PUBLIC_* values in client bundles when each key is
// referenced directly. Passing the whole process.env object leaves these
// values undefined in the browser even when they are present at build time.
const parsedPublicEnv = publicEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_LIFF_ID: process.env.NEXT_PUBLIC_LIFF_ID,
  NEXT_PUBLIC_LIFF_BOOKING_ID: process.env.NEXT_PUBLIC_LIFF_BOOKING_ID,
  NEXT_PUBLIC_LIFF_LINK_ID: process.env.NEXT_PUBLIC_LIFF_LINK_ID,
});

if (!parsedPublicEnv.success) {
  const issues = parsedPublicEnv.error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join(", ");
  throw new Error(`Invalid public environment variables: ${issues}`);
}

export const publicEnv = parsedPublicEnv.data;
