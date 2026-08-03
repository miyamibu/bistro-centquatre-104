import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const savedEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...savedEnv };
});

function request(method: "POST" | "DELETE") {
  return new NextRequest("http://localhost:3000/api/line/customer-link", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      // Deliberately represents an attacker-supplied verified LINE token and
      // a victim's phone. The route must reject before token/DB processing.
      phone: "090-1234-5678",
      lineIdToken: "attacker-id-token",
    }),
  });
}

async function loadRoute() {
  vi.resetModules();
  process.env.LINE_PHONE_AUTO_ATTACH_ENABLED = "true";
  return import("@/app/api/line/customer-link/route");
}

describe("/api/line/customer-link", () => {
  it("rejects phone-only registration even when the legacy flag is true", async () => {
    const { POST } = await loadRoute();
    const response = await POST(request("POST"));
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.code).toBe("LINE_CUSTOMER_LINK_REQUIRES_RESERVATION_TOKEN");
  });

  it("rejects phone-only revocation instead of mutating a phone link", async () => {
    const { DELETE } = await loadRoute();
    const response = await DELETE(request("DELETE"));
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.code).toBe("LINE_CUSTOMER_LINK_REQUIRES_RESERVATION_TOKEN");
  });
});
