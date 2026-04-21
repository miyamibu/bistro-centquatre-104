import { createCipheriv, createHash, randomBytes } from "crypto";
import { env } from "@/lib/env";

function toPgBytea(value: Buffer) {
  return `\\x${value.toString("hex")}`;
}

export function getBankHistoryKey() {
  const seed = env.BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY;

  if (!seed) {
    throw new Error("BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY_MISSING");
  }

  return createHash("sha256").update(seed).digest();
}

export function encryptBankHistoryValue(value: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getBankHistoryKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: toPgBytea(encrypted),
    nonce: toPgBytea(nonce),
    authTag: toPgBytea(authTag),
  };
}
