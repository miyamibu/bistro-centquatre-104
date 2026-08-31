import { describe, expect, it } from "vitest";
import nextConfig from "../next.config.mjs";

type HeaderConfig = {
  key: string;
  value: string;
};

type HeaderEntry = {
  headers: HeaderConfig[];
};

describe("Next security headers", () => {
  it("does not disclose the framework through X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("enforces the production CSP header", async () => {
    const entries = (await nextConfig.headers?.()) as HeaderEntry[] | undefined;
    const headers = entries?.flatMap((entry: HeaderEntry) => entry.headers) ?? [];
    const csp = headers.find((header) => header.key === "Content-Security-Policy");

    expect(csp?.value).toContain("default-src 'self'");
    expect(csp?.value).toContain("frame-ancestors 'none'");
    expect(csp?.value).toContain("https://api.line.me");
    expect(csp?.value).toContain("https://access.line.me");
    expect(csp?.value).toContain("https://static.line-scdn.net");
    expect(csp?.value).toContain("https://liffsdk.line-scdn.net");
    expect(csp?.value).toContain("https://liff.line.me");
    expect(csp?.value).toContain("https://www.google.com");
    expect(csp?.value).toContain("https://images.unsplash.com");
    expect(headers.find((header) => header.key === "Content-Security-Policy-Report-Only")).toBeUndefined();
  });
});
