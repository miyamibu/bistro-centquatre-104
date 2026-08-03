import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260731090000_atomic_terminal_order_action.sql"),
  "utf8"
);

describe("atomic terminal order action SQL contract", () => {
  it("uses a durable lease and reconciles an expired legacy claim", () => {
    expect(migration).toContain("claim_expires_at timestamptz");
    expect(migration).toContain("coalesce(v_idempotency.claim_expires_at");
    expect(migration).toContain("IDEMPOTENCY_IN_PROGRESS");
    expect(migration).toContain("IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("idempotency_key = p_idempotency_key");
    expect(migration).toContain("claim_expires_at = now() - interval '1 second'");
  });

  it("keeps both terminal actions, snapshot, and response finalization in one RPC", () => {
    const shippedCall = migration.indexOf("public.mark_order_shipped_action(");
    const cancelCall = migration.indexOf("public.cancel_order_action(");
    const historyInsert = migration.indexOf("insert into public.order_history");
    const finalizeUpdate = migration.indexOf("response_status = v_status");

    expect(shippedCall).toBeGreaterThan(-1);
    expect(cancelCall).toBeGreaterThan(-1);
    expect(historyInsert).toBeGreaterThan(shippedCall);
    expect(historyInsert).toBeGreaterThan(cancelCall);
    expect(finalizeUpdate).toBeGreaterThan(historyInsert);
    expect(migration).toContain("exception\n    when others then");
    expect(migration).toContain("raise exception 'IDEMPOTENCY_FINALIZE_FAILED'");
    expect(migration).toContain("on conflict (id) do nothing;");
  });

  it("retains the request hash and expected-version boundaries", () => {
    expect(migration).toContain("v_idempotency.request_hash <> p_request_hash");
    expect(migration).toContain("p_expected_version");
    expect(migration).toContain("p_reason_code");
    expect(migration).toContain("p_actor_type");
    expect(migration).toContain("p_request_id");
    expect(migration).toContain("p_idempotency_key");
  });
});
