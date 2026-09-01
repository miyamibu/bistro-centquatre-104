import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const deployScript = readFileSync("scripts/deploy-cloudflare-workers.mjs", "utf8");
const router = readFileSync("workers/default.mjs", "utf8");
const routerConfig = readFileSync("wrangler.default.jsonc", "utf8");

describe("Cloudflare release safety", () => {
  it("requires an exact clean Git HEAD and records rollback targets", () => {
    expect(deployScript).toContain("--expected-head=");
    expect(deployScript).toContain('git", ["status", "--porcelain", "--untracked-files=no"]');
    expect(deployScript).toContain("previousVersionId");
    expect(deployScript).toContain('"rollback"');
    expect(deployScript).toContain("deployed.reverse()");
  });

  it("deploys the public router last with the release SHA", () => {
    const configEntries = [...deployScript.matchAll(/"(wrangler\.[^"]+\.jsonc)"/g)].map(
      (match) => match[1],
    );
    expect(configEntries.at(-1)).toBe("wrangler.default.jsonc");
    expect(deployScript).toContain("RELEASE_SHA:${expectedHead}");
    expect(deployScript).toContain("git:${expectedHead}");
  });

  it("exposes non-secret release and Worker version metadata", () => {
    expect(router).toContain('pathname === "/api/release"');
    expect(router).toContain('"X-Bistro-Release-SHA"');
    expect(router).toContain("env.CF_VERSION_METADATA?.id");
    expect(routerConfig).toContain('"version_metadata": { "binding": "CF_VERSION_METADATA" }');
  });
});
