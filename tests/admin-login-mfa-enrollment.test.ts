import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("admin login AAL2 path", () => {
  it("requires a verified TOTP challenge after password sign-in", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/admin/login/page.tsx"),
      "utf8",
    );

    const passwordSignIn = source.indexOf("await supabase.auth.signInWithPassword");
    const challenge = source.indexOf("supabase.auth.mfa.challenge", passwordSignIn);
    const verify = source.indexOf("supabase.auth.mfa.verify", challenge);
    const assurance = source.indexOf("getAuthenticatorAssuranceLevel", verify);
    const directNavigation = source.indexOf("router.replace(nextPath()", assurance);

    expect(passwordSignIn).toBeGreaterThanOrEqual(0);
    expect(challenge).toBeGreaterThan(passwordSignIn);
    expect(verify).toBeGreaterThan(challenge);
    expect(assurance).toBeGreaterThan(verify);
    expect(directNavigation).toBeGreaterThan(assurance);
    expect(source).toContain("認証アプリの6桁コード");
    expect(source).toContain("/admin/mfa/setup");
  });
});
