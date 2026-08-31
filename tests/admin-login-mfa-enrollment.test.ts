import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("admin login MFA enrollment path", () => {
  it("checks factors after password sign-in so an unenrolled staff user reaches setup", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/admin/login/page.tsx"),
      "utf8",
    );

    const passwordSignIn = source.indexOf("await supabase.auth.signInWithPassword");
    const factorCheck = source.indexOf("await beginMfa()", passwordSignIn);

    expect(passwordSignIn).toBeGreaterThanOrEqual(0);
    expect(factorCheck).toBeGreaterThan(passwordSignIn);
    expect(source.slice(passwordSignIn, factorCheck)).not.toContain(
      "getAuthenticatorAssuranceLevel",
    );
  });
});
