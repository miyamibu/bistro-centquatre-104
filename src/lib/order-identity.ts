import { createHash } from "node:crypto";

export function buildOrderActorKey(email: string, phone: string) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
      }),
    )
    .digest("hex");

  return `order-create:${digest}`;
}
