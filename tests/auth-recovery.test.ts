import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("Supabase password recovery handoff", () => {
  it("uses a dedicated client route for the fragment-based recovery session", () => {
    const login = source("src/app/admin/login/page.tsx");
    const recovery = source("src/app/auth/recovery/page.tsx");

    expect(login).toContain('new URL("/auth/recovery", window.location.origin)');
    expect(recovery).toContain('event === "PASSWORD_RECOVERY"');
    expect(recovery).toContain('event === "SIGNED_IN"');
    expect(recovery).toContain("supabase.auth.getSession()");
    expect(recovery).toContain('router.replace("/admin/password-reset"');
    expect(recovery).toContain("subscription.unsubscribe()");
  });
});
