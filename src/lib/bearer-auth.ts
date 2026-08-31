import { timingSafeEqual } from "node:crypto";

export function isBearerSecretAuthorized(
  authorization: string | null,
  expectedSecret: string | null | undefined,
): boolean {
  if (!authorization || !expectedSecret) return false;

  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;

  const provided = Buffer.from(authorization.slice(prefix.length), "utf8");
  const expected = Buffer.from(expectedSecret, "utf8");
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}
