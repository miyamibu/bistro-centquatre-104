import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_JSON_BODY_LIMIT_BYTES } from "@/lib/api-security";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/reservations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-requested-with": "XMLHttpRequest",
    },
    body: JSON.stringify(body),
  });
}

function buildOversizedStreamRequest() {
  const payload = `{"note":"${"x".repeat(DEFAULT_JSON_BODY_LIMIT_BYTES)}"}`;
  const encoded = new TextEncoder().encode(payload);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });

  return new NextRequest("http://localhost:3000/api/reservations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-requested-with": "XMLHttpRequest",
      "idempotency-key": "stream-oversize-test",
    },
    body,
    duplex: "half",
  });
}

describe("reservations route", () => {
  it("rejects public private-block creation requests", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const response = await POST(
      buildRequest({
        reservationType: "PRIVATE_BLOCK",
        privateBlockAccessCode: "secret",
        date: "2026-04-24",
        arrivalTime: "11:30",
        lastName: "貸切",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe("PRIVATE_BLOCK_PUBLIC_DISABLED");
  });

  it("returns 413 when the streamed body exceeds the route limit", async () => {
    const { POST } = await import("@/app/api/reservations/route");
    const response = await POST(buildOversizedStreamRequest());
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.code).toBe("BODY_TOO_LARGE");
  });
});
