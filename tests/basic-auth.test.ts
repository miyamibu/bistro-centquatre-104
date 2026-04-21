import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { parseBasicAuthHeader } from "@/lib/basic-auth";
import { middleware } from "@/middleware";
import { GET as getAdminBusinessDays } from "@/app/api/admin/business-days/route";

describe("Basic auth hardening", () => {
  it("treats malformed base64 credentials as null instead of throwing", () => {
    expect(parseBasicAuthHeader("Basic A===")).toBeNull();
    expect(parseBasicAuthHeader("Basic Zm9v")).toBeNull();
  });

  it("returns 401 from middleware for malformed Basic header", () => {
    const request = new NextRequest("http://localhost:3000/admin/reservations", {
      headers: {
        authorization: "Basic A===",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("returns 401 from admin route for malformed Basic header", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/business-days", {
      headers: {
        authorization: "Basic A===",
      },
    });

    const response = await getAdminBusinessDays(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
