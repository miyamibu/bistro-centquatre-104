import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .preprocess(emptyToUndefined, z.string().url().optional())
    .catch(undefined),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

const parsedPublicEnv = publicEnvSchema.safeParse(process.env);

if (!parsedPublicEnv.success) {
  const issues = parsedPublicEnv.error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join(", ");
  throw new Error(`Invalid public environment variables: ${issues}`);
}

export const publicEnv = parsedPublicEnv.data;
