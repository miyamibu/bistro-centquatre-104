import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260901140000_atomic_nonterminal_order_mutations.sql",
  ),
  "utf8",
);
const createRoute = readFileSync(resolve(process.cwd(), "src/app/api/orders/route.ts"), "utf8");
const actionRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/orders/[id]/actions/route.ts"),
  "utf8",
);
const verifySql = readFileSync(resolve(process.cwd(), "supabase/verify.sql"), "utf8");
const readonlyChecks = readFileSync(
  resolve(process.cwd(), "docs/release/production-db-readonly-checks-2026-06-21.sql"),
  "utf8",
);

describe("atomic non-terminal order mutation release contract", () => {
  it("claims, mutates, and finalizes inside one database RPC", () => {
    const claim = migration.indexOf("for update;");
    const create = migration.indexOf("public.create_order_quote_with_receipt_action(");
    const confirm = migration.indexOf("public.confirm_order_human_action(");
    const setPayment = migration.indexOf("public.set_order_payment_method_action(");
    const markPaid = migration.indexOf("public.mark_order_paid_action(");
    const markCollected = migration.indexOf("public.mark_order_collected_action(");
    const finalize = migration.indexOf("response_status = p_success_status");

    expect(claim).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(claim);
    expect(confirm).toBeGreaterThan(claim);
    expect(setPayment).toBeGreaterThan(claim);
    expect(markPaid).toBeGreaterThan(claim);
    expect(markCollected).toBeGreaterThan(claim);
    expect(finalize).toBeGreaterThan(markCollected);
    expect(migration).toContain("on conflict (scope, actor_key, idempotency_key) do nothing");
    expect(migration).toContain("v_idempotency.request_hash <> p_request_hash");
    expect(migration).toContain("'replayed', true");
    expect(migration).toContain("claim_token = v_claim_token");
    expect(migration).toContain("IDEMPOTENCY_RECOVERY_CONFLICT");
    expect(migration).toContain("Never rerun it");
  });

  it("keeps public routes on the atomic RPC and terminal actions on their existing RPC", () => {
    expect(createRoute).toContain("executeAtomicOrderMutation({");
    expect(createRoute).not.toContain("runIdempotentMutation({");
    expect(actionRoute.match(/executeAtomicOrderMutation\(\{/g)).toHaveLength(4);
    expect(actionRoute).not.toContain("runIdempotentMutation({");
    expect(actionRoute.match(/executeAtomicTerminalOrderAction\(\{/g)).toHaveLength(2);
  });

  it("hardens the RPC ACL and release database assertions", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = pg_catalog, public");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");

    for (const sql of [verifySql, readonlyChecks]) {
      expect(sql).toContain("execute_atomic_order_mutation");
      expect(sql).toContain("claim_token");
      expect(sql).toContain("claim_expires_at");
      expect(sql).toContain("idx_api_idempotency_unfinalized_claim");
      expect(sql).toContain("rolbypassrls");
      expect(sql).toContain("rolsuper");
      expect(sql).toContain("SECURITY INVOKER");
      expect(sql).toContain("service_role");
    }
  });
});
