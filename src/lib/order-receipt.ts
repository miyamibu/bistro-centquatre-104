import { createHash, randomBytes } from "node:crypto";

export const ORDER_RECEIPT_TOKEN_MAX_LENGTH = 256;

export function createOrderReceiptToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOrderReceiptToken(token: string) {
  return createHash("sha256")
    .update(`bistro:order-receipt:${token}`)
    .digest("hex");
}
