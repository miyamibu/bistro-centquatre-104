import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

async function loadCronRoutes() {
  vi.resetModules();

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.CRON_SECRET = "expected-secret";

  const cancelModule = await import("@/app/api/crons/cancel-expired-orders/route");
  const deleteModule = await import("@/app/api/crons/delete-old-histories/route");

  return {
    cancelExpiredPost: cancelModule.POST,
    deleteHistoriesPost: deleteModule.POST,
  };
}

afterEach(() => {
  vi.resetModules();
});

describe("cron auth boundary", () => {
  it("rejects unauthenticated cancel-expired-orders", async () => {
    const { cancelExpiredPost } = await loadCronRoutes();
    const request = new NextRequest("http://localhost:3000/api/crons/cancel-expired-orders", {
      method: "POST",
    });

    const response = await cancelExpiredPost(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects invalid bearer token for delete-old-histories", async () => {
    const { deleteHistoriesPost } = await loadCronRoutes();
    const request = new NextRequest("http://localhost:3000/api/crons/delete-old-histories", {
      method: "POST",
      headers: {
        authorization: "Bearer invalid-token",
      },
    });

    const response = await deleteHistoriesPost(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
