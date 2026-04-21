import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    },
    body: JSON.stringify(body),
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
});
