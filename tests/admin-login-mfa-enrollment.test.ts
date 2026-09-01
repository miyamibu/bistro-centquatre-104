import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("admin login password-only path", () => {
  it("routes directly after password sign-in without starting MFA", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/admin/login/page.tsx"),
      "utf8",
    );

    const passwordSignIn = source.indexOf("await supabase.auth.signInWithPassword");
    const directNavigation = source.indexOf("router.replace(nextPath()", passwordSignIn);

    expect(passwordSignIn).toBeGreaterThanOrEqual(0);
    expect(directNavigation).toBeGreaterThan(passwordSignIn);
    expect(source.slice(passwordSignIn, directNavigation)).not.toContain("beginMfa");
    expect(source).not.toContain("auth.mfa.challenge");
    expect(source).not.toContain("認証アプリの6桁コード");
  });
});
