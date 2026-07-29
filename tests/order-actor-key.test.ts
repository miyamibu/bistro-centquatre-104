import { describe, expect, it } from "vitest";
import { buildOrderActorKey } from "@/lib/order-identity";

describe("buildOrderActorKey", () => {
  it("does not retain customer email or phone in the actor key", () => {
    const key = buildOrderActorKey("Guest@example.com", "090-1234-5678");

    expect(key).toMatch(/^order-create:[a-f0-9]{64}$/);
    expect(key).not.toContain("Guest@example.com");
    expect(key).not.toContain("090-1234-5678");
  });

  it("is stable for normalized email and phone input", () => {
    expect(buildOrderActorKey(" Guest@Example.com ", "090-1234-5678")).toBe(
      buildOrderActorKey("guest@example.com", "090-1234-5678"),
    );
  });
});
