import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260805100000_fence_api_idempotency_claims.sql"),
  "utf8"
);

describe("idempotency claim fence migration", () => {
  it("adds a claim token and gives legacy unfinished claims a full rollout lease", () => {
    expect(migration).toContain("add column if not exists claim_token uuid");
    expect(migration).toContain(
      "greatest(created_at + interval '5 minutes', now() + interval '5 minutes')"
    );
    expect(migration).not.toContain("greatest(created_at + interval '5 minutes', now())");
    expect(migration).toContain("response_status is null");
    expect(migration).toContain("response_body is null");
  });
});
