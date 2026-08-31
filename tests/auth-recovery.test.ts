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
    expect(recovery).toContain('fragment.get("type") === "recovery"');
    expect(recovery).toContain("supabase.auth.setSession");
    expect(recovery).toContain("supabase.auth.getSession()");
    expect(recovery).toContain("window.history.replaceState");
    expect(recovery).toContain('window.location.replace("/admin/password-reset")');
  });
});
