import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { enforceWriteRequestSecurity } from "@/lib/api-security";

function buildRequest(headers: Record<string, string>) {
  return new NextRequest("http://localhost:3000/api/orders", {
    method: "POST",
    headers,
  });
}

describe("API Security", () => {
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
});

