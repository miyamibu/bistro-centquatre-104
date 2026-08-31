import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPageMetadata, NO_INDEX_METADATA, SITE_URL } from "@/lib/seo";

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const layoutSource = readSource("src/app/layout.tsx");
const appShellSource = readSource("src/components/app-shell.tsx");
const homePageSource = readSource("src/app/page.tsx");
const contactSource = readSource("src/lib/contact.ts");

const indexedRouteMetadataSources: Record<string, string> = {
  "/": "src/app/layout.tsx",
  "/access": "src/app/access/page.tsx",
  "/booking": "src/app/booking/page.tsx",
  "/contact": "src/app/contact/page.tsx",
  "/daily-journal": "src/app/daily-journal/page.tsx",
  "/faq": "src/app/faq/page.tsx",
  "/hors-doeuvre": "src/app/hors-doeuvre/layout.tsx",
  "/legal": "src/app/legal/page.tsx",
  "/menu": "src/app/menu/layout.tsx",
  "/on-line-store": "src/app/on-line-store/layout.tsx",
  "/on-line-store/apron": "src/app/on-line-store/apron/layout.tsx",
  "/picture": "src/app/picture/page.tsx",
  "/privacy": "src/app/privacy/page.tsx",
  "/agents": "src/app/agents/page.tsx",
};

const noIndexMetadataSources: Record<string, string> = {
  "/admin": "src/app/admin/layout.tsx",
  "/dashboard/orders": "src/app/dashboard/layout.tsx",
  "/staff": "src/app/staff/layout.tsx",
  "/line/link": "src/app/line/link/layout.tsx",
  "/on-line-store/cart": "src/app/on-line-store/cart/layout.tsx",
  "/on-line-store/order-complete": "src/app/on-line-store/order-complete/layout.tsx",
  "/on-line-store/pay": "src/app/on-line-store/pay/layout.tsx",
};

function classNameForAriaLabel(source: string, label: string) {
  const match = source.match(new RegExp(`aria-label="${label}"\\s+className="([^"]+)"`));
  expect(match, `aria-label=${label} のクラス定義が見つかること`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("public layout regression contracts", () => {
  it("builds route-specific canonical and Open Graph URLs", () => {
    expect(createPageMetadata("/").alternates?.canonical).toBe(SITE_URL);
    expect(createPageMetadata("/privacy/").alternates?.canonical).toBe(
      `${SITE_URL}/privacy`
    );
    expect(createPageMetadata("/on-line-store/apron?mode=agent").alternates?.canonical).toBe(
      `${SITE_URL}/on-line-store/apron`
    );

    for (const pathname of Object.keys(indexedRouteMetadataSources)) {
      const metadata = createPageMetadata(pathname);
      const canonicalUrl =
        pathname === "/"
          ? SITE_URL
          : new URL(pathname, SITE_URL).toString();
      expect(metadata.alternates?.canonical, pathname).toBe(canonicalUrl);
      expect(metadata.openGraph, pathname).toMatchObject({
        type: "website",
        locale: "ja_JP",
        url: canonicalUrl,
        siteName: "bistro centquatre 104",
      });
      expect(metadata.twitter, pathname).toMatchObject({
        card: "summary",
        title: "ビストロ　サンキャトル　１０４",
      });
    }
  });

  it("keeps metadataBase shared while every public route references the SEO helper", () => {
    expect(layoutSource).toContain("metadataBase: new URL(SITE_URL)");

    for (const [pathname, relativePath] of Object.entries(indexedRouteMetadataSources)) {
      const source = pathname === "/" ? layoutSource : readSource(relativePath);
      const metadataCall = source.slice(source.indexOf("createPageMetadata("));
      expect(metadataCall, `${pathname} (${relativePath})`).toContain("createPageMetadata(");
      expect(metadataCall, `${pathname} (${relativePath})`).toContain(`"${pathname}"`);
    }

    const dailyJournalSource = readSource("src/app/daily-journal/page.tsx");
    expect(dailyJournalSource).toContain('"日々の出来事 | ビストロ サンキャトル 104"');
    expect(dailyJournalSource).toContain(
      '"仕込み、料理、季節のこと。ビストロ サンキャトル 104 の日々をお届けします。"'
    );
  });

  it("leaves head ownership to Next.js so Netlify production metadata cannot break hydration", () => {
    expect(layoutSource).not.toContain("<head");
    expect(layoutSource).toContain('"text/plain": "/llms.txt"');
    expect(layoutSource).toContain('"text/html": "/agents"');
    expect(layoutSource).toContain('"application/json": "/api/agent"');
    expect(layoutSource.indexOf('type="text/llms.txt"')).toBeGreaterThan(
      layoutSource.indexOf("<body")
    );
  });

  it("keeps protected and transaction-helper routes out of search metadata", () => {
    expect(NO_INDEX_METADATA).toMatchObject({
      robots: { index: false, follow: false },
      alternates: null,
      openGraph: null,
      twitter: null,
    });

    for (const [pathname, relativePath] of Object.entries(noIndexMetadataSources)) {
      const source = readSource(relativePath);
      expect(source, `${pathname} (${relativePath})`).toContain("NO_INDEX_METADATA");
    }
  });

  it("keeps privacy and legal pages inside the shared public footer shell", () => {
    const publicRouteExpression = appShellSource.slice(
      appShellSource.indexOf("const isPublicWebRoute"),
      appShellSource.indexOf("const shellWidthClass")
    );

    for (const pathname of ["/privacy", "/legal"]) {
      expect(publicRouteExpression).toContain(`pathname === "${pathname}" ||`);
      expect(publicRouteExpression).toContain(`pathname.startsWith("${pathname}/") ||`);
    }

    expect(appShellSource).toContain("!hideTopNav && isPublicWebRoute");
    expect(appShellSource).toContain('href="/privacy"');
    expect(appShellSource).toContain('href="/legal"');
  });

  it("keeps the home access map responsive and delays side tabs until xl", () => {
    expect(homePageSource).toContain(
      "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:justify-center md:gap-16 md:px-4"
    );
    expect(homePageSource).toContain("md:w-full md:max-w-[550px]");
    expect(homePageSource).not.toContain("md:w-[550px] md:max-w-[550px]");

    const reservationTabClass = classNameForAriaLabel(homePageSource, "予約");
    const storeTabClass = classNameForAriaLabel(homePageSource, "オンラインストア");

    for (const className of [reservationTabClass, storeTabClass]) {
      expect(className).toContain("hidden");
      expect(className).toContain("xl:block");
      expect(className).not.toContain("md:block");
    }
  });

  it("does not expose the stale Toda city label in the Cent Quatre course", () => {
    expect(homePageSource).not.toContain("戸田市");
    expect(homePageSource).toContain('title: "６品 8,000円"');
  });

  it("keeps inline access and legal actions at a 44px touch target", () => {
    for (const relativePath of ["src/app/access/page.tsx", "src/app/legal/page.tsx"]) {
      expect(readSource(relativePath), relativePath).toContain("min-h-11");
    }
  });

  it("uses identical public contact values during server render and hydration", () => {
    expect(contactSource).not.toContain('typeof window === "undefined"');
    expect(contactSource).toContain("process.env.NEXT_PUBLIC_CONTACT_PHONE_DISPLAY");
    expect(contactSource).toContain(
      "process.env.CONTACT_PHONE_DISPLAY ?? CONTACT_PHONE_DISPLAY",
    );
  });
});
