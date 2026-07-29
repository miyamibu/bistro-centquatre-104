import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as getAgentManifest } from "@/app/api/agent/route";
import { GET as getLlmsText } from "@/app/llms.txt/route";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { SITE_URL } from "@/lib/seo";

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("public agent contract", () => {
  it("publishes reservation handoff-only policy without a direct completion contract", async () => {
    const response = getAgentManifest(new Request(`${SITE_URL}/api/agent?pretty=1`));
    const manifest = await response.json();
    const serialized = JSON.stringify(manifest);

    expect(manifest.reservation).toMatchObject({
      supports_direct_completion: false,
      handoff: {
        method: "GET",
        endpoint: "/booking",
        final_submission: "Human review and submission are required on /booking.",
      },
    });
    expect(manifest.reservation).not.toHaveProperty("direct_completion");
    expect(manifest.routes).not.toHaveProperty("reservations_api");
    expect(serialized).not.toContain("may be completed directly");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps llms.txt handoff-only and non-cacheable", async () => {
    const response = getLlmsText();
    const body = await response.text();

    expect(body).toContain("Human handoff only");
    expect(body).toContain("AI agents must not call POST /api/reservations");
    expect(body).toContain("Final review and submission must be completed by a human");
    expect(body).not.toContain("Direct completion:");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("public discovery metadata", () => {
  it("serves robots rules from the canonical site and excludes protected transactions", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const disallowed = rules.flatMap((rule) =>
      Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : []
    );

    expect(result.host).toBe(SITE_URL);
    expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(disallowed).toEqual(
      expect.arrayContaining([
        "/admin",
        "/api",
        "/booking",
        "/dashboard",
        "/line",
        "/staff",
        "/on-line-store/cart",
        "/on-line-store/pay",
      ])
    );
  });

  it("lists only canonical public pages in sitemap.xml", () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls).toContain(SITE_URL);
    expect(urls).toContain(`${SITE_URL}/menu`);
    expect(urls).toContain(`${SITE_URL}/on-line-store/apron`);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((url) => url.startsWith(SITE_URL))).toBe(true);
    expect(
      urls.some((url) =>
        ["/admin", "/api", "/booking", "/dashboard", "/line", "/staff", "/cart", "/pay"].some(
          (path) => new URL(url).pathname.startsWith(path)
        )
      )
    ).toBe(false);
  });
});

describe("deployment and documentation contracts", () => {
  it("ignores only the root backup directory in Vercel packaging", () => {
    const lines = readSource(".vercelignore")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(lines).toContain("/backups/");
    expect(lines).not.toContain("backups/");
  });

  it("declares DIRECT_URL by key name in every safe env example", () => {
    for (const relativePath of [".env.example", ".env.local.example", ".env.test.example"]) {
      expect(readSource(relativePath), relativePath).toMatch(/^DIRECT_URL=$/m);
    }
  });

  it("keeps launch documentation aligned with the required direct database URL", () => {
    expect(readSource("docs/production-launch.md")).toContain("DIRECT_URL");
    expect(readSource("docs/release/external-verification-runbook-2026-06-21.md")).toContain(
      "DIRECT_URL"
    );
    expect(readSource("DESIGN.md")).not.toMatch(/Bistro Joa/i);
  });

  it("keeps README reservation policy aligned with reservation-config", () => {
    const readme = readSource("README.md");

    expect(readme).toContain("9名以上は電話受付のみ");
    expect(readme).toContain("ランチ `11:30-12:30`");
    expect(readme).toContain("ディナー `17:30-19:30`");
    expect(readme).not.toContain("10名以上予約は貸切扱い");
    expect(readme).not.toContain("来店時間は `17:30` 以降");
  });

  it("bounds dashboard order reads and avoids wildcard order projections", () => {
    const route = readSource("src/app/api/dashboard/orders/route.ts");
    const page = readSource("src/app/dashboard/orders/page.tsx");
    const orderQuery = (source: string) => {
      const match = source.match(/from\("orders"\)[\s\S]*?\.range\([^\n]+\)/);
      expect(match).not.toBeNull();
      return match?.[0] ?? "";
    };

    expect(route).toContain("const ORDER_LIST_LIMIT = 100");
    expect(route).toContain(".range(0, ORDER_LIST_LIMIT - 1)");
    expect(page).toContain("const ORDER_LIST_LIMIT = 100");
    expect(page).toContain(".range(0, ORDER_LIST_LIMIT - 1)");
    expect(orderQuery(route)).not.toContain('select("*")');
    expect(orderQuery(page)).not.toContain('select("*")');
  });
});
