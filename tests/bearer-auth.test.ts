import { describe, expect, it } from "vitest";
import { isBearerSecretAuthorized } from "@/lib/bearer-auth";

describe("isBearerSecretAuthorized", () => {
  it("accepts only the exact configured bearer secret", () => {
    expect(isBearerSecretAuthorized("Bearer expected-secret", "expected-secret")).toBe(true);
    expect(isBearerSecretAuthorized("Bearer expected-secreu", "expected-secret")).toBe(false);
  });

  it("rejects missing, malformed, and length-mismatched credentials", () => {
    expect(isBearerSecretAuthorized(null, "expected-secret")).toBe(false);
    expect(isBearerSecretAuthorized("Basic expected-secret", "expected-secret")).toBe(false);
    expect(isBearerSecretAuthorized("Bearer short", "expected-secret")).toBe(false);
    expect(isBearerSecretAuthorized("Bearer expected-secret", undefined)).toBe(false);
  });
});
