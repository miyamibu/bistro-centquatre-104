import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  enforceWriteRequestSecurity,
  ORDER_JSON_BODY_LIMIT_BYTES,
  readLimitedJson,
} from "@/lib/api-security";

function buildRequest(headers: Record<string, string>) {
  return new NextRequest("http://localhost:3000/api/orders", {
    method: "POST",
    headers,
  });
}

describe("API Security", () => {
  it("allows the current Netlify deploy origin when the runtime request URL is rewritten", () => {
    const previousDeployPrimeUrl = process.env.DEPLOY_PRIME_URL;
    process.env.DEPLOY_PRIME_URL = "https://deploy-preview-2--bistro.example";

    try {
      const request = buildRequest({
        "content-type": "application/json",
        origin: "https://deploy-preview-2--bistro.example",
        "sec-fetch-site": "same-origin",
        "x-requested-with": "XMLHttpRequest",
      });
      expect(enforceWriteRequestSecurity(request, { requestId: "test-id" })).toBeNull();
    } finally {
      if (previousDeployPrimeUrl === undefined) {
        delete process.env.DEPLOY_PRIME_URL;
      } else {
        process.env.DEPLOY_PRIME_URL = previousDeployPrimeUrl;
      }
    }
  });

  it("does not allow an unrelated origin when a Netlify deploy origin is configured", async () => {
    const previousDeployPrimeUrl = process.env.DEPLOY_PRIME_URL;
    process.env.DEPLOY_PRIME_URL = "https://deploy-preview-2--bistro.example";

    try {
      const request = buildRequest({
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "same-site",
        "x-requested-with": "XMLHttpRequest",
      });
      const result = enforceWriteRequestSecurity(request, { requestId: "test-id" });
      expect(result?.status).toBe(403);
      await expect(result?.json()).resolves.toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    } finally {
      if (previousDeployPrimeUrl === undefined) {
        delete process.env.DEPLOY_PRIME_URL;
      } else {
        process.env.DEPLOY_PRIME_URL = previousDeployPrimeUrl;
      }
    }
  });

  it("allows same-origin JSON request with X-Requested-With", () => {
    const request = buildRequest({
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-requested-with": "XMLHttpRequest",
    });
    const result = enforceWriteRequestSecurity(request, { requestId: "test-id" });
    expect(result).toBeNull();
  });

  it("blocks missing X-Requested-With", async () => {
    const request = buildRequest({
      "content-type": "application/json",
      origin: "http://localhost:3000",
    });
    const result = enforceWriteRequestSecurity(request, { requestId: "test-id" });
    expect(result?.status).toBe(400);
    const body = await result?.json();
    expect(body?.code).toBe("MISSING_REQUEST_HEADER");
  });

  it("blocks write requests when an origin is required but missing", async () => {
    const request = buildRequest({
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
    });
    const result = enforceWriteRequestSecurity(request, {
      requestId: "test-id",
      requireOrigin: true,
    });
    expect(result?.status).toBe(403);
    const body = await result?.json();
    expect(body?.code).toBe("ORIGIN_REQUIRED");
  });

  it("blocks cross-site requests", async () => {
    const request = buildRequest({
      "content-type": "application/json",
      origin: "https://malicious.example",
      "sec-fetch-site": "cross-site",
      "x-requested-with": "XMLHttpRequest",
    });
    const result = enforceWriteRequestSecurity(request, { requestId: "test-id" });
    expect(result?.status).toBe(403);
    const body = await result?.json();
    expect(body?.code).toBe("CSRF_BLOCKED");
  });

  it("blocks non-json requests", async () => {
    const request = buildRequest({
      "content-type": "text/plain",
      origin: "http://localhost:3000",
      "x-requested-with": "XMLHttpRequest",
    });
    const result = enforceWriteRequestSecurity(request, { requestId: "test-id" });
    expect(result?.status).toBe(415);
  });

  it("blocks oversized content-length before reading body", async () => {
    const request = buildRequest({
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-requested-with": "XMLHttpRequest",
      "content-length": "1025",
    });
    const result = await readLimitedJson(request, { maxBytes: 1024, requestId: "test-id" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      const body = await result.response.json();
      expect(body.code).toBe("BODY_TOO_LARGE");
    }
  });

  it("applies the larger but explicit order body limit", async () => {
    const request = buildRequest({
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-requested-with": "XMLHttpRequest",
      "content-length": String(ORDER_JSON_BODY_LIMIT_BYTES + 1),
    });
    const result = await readLimitedJson(request, {
      maxBytes: ORDER_JSON_BODY_LIMIT_BYTES,
      requestId: "test-id",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
      await expect(result.response.json()).resolves.toMatchObject({ code: "BODY_TOO_LARGE" });
    }
  });

  it("blocks oversized streamed body", async () => {
    const request = new NextRequest("http://localhost:3000/api/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({ value: "x".repeat(64) }),
    });
    const result = await readLimitedJson(request, { maxBytes: 16, requestId: "test-id" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(413);
    }
  });

  it("returns malformed JSON before route validation", async () => {
    const request = new NextRequest("http://localhost:3000/api/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-requested-with": "XMLHttpRequest",
      },
      body: "{not-json",
    });
    const result = await readLimitedJson(request, { requestId: "test-id" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.code).toBe("MALFORMED_JSON");
    }
  });
});

