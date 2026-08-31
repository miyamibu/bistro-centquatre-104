import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("public client environment bundling", () => {
  it("references every browser-visible variable directly for Next.js inlining", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/env-public.ts"), "utf8");

    expect(source).not.toContain("safeParse(process.env)");
    for (const name of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_LIFF_ID",
      "NEXT_PUBLIC_LIFF_BOOKING_ID",
      "NEXT_PUBLIC_LIFF_LINK_ID",
    ]) {
      expect(source).toContain(`${name}: process.env.${name}`);
    }
  });
});
