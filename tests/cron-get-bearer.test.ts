/**
 * P2: Vercel Cron GET routes must not return 405 when called with only a valid
 * Bearer token (no x-vercel-cron header required).
 *
 * Vercel Cron sends HTTP GET — these tests confirm that the guard is purely
 * Bearer-auth-based, not tied to a Vercel-specific header.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const CRON_SECRET = "test-cron-secret-value";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

// ── remind ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([]),
    reservation: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    reservationLineLinkToken: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    notificationEvent: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/scheduler-heartbeat", () => ({
  readSchedulerContext: vi.fn(() => ({ schedulerKind: "API_CRON", runId: null })),
  markSchedulerStarted: vi.fn().mockResolvedValue(undefined),
  markSchedulerSucceeded: vi.fn().mockResolvedValue(undefined),
  markSchedulerFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

function makeGetRequest(path: string, bearerToken?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "GET",
    headers: bearerToken ? { authorization: `Bearer ${bearerToken}` } : {},
  });
}

async function loadRemind() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.CRON_SECRET = CRON_SECRET;
  return import("@/app/api/crons/remind/route");
}

async function loadCancelExpired() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.CRON_SECRET = CRON_SECRET;
  return import("@/app/api/crons/cancel-expired-orders/route");
}

async function loadDeleteHistories() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.CRON_SECRET = CRON_SECRET;
  return import("@/app/api/crons/delete-old-histories/route");
}

describe("/api/crons/remind GET", () => {
  it("returns 401 (not 405) when no Authorization header is provided", async () => {
    const { GET } = await loadRemind();
    const res = await GET(makeGetRequest("/api/crons/remind"));
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(405);
  });

  it("does NOT return 405 when Authorization: Bearer <secret> is correct (no x-vercel-cron)", async () => {
    const { GET } = await loadRemind();
    const res = await GET(makeGetRequest("/api/crons/remind", CRON_SECRET));
    // Should be 200/500 (DB not wired), definitely not 405.
    expect(res.status).not.toBe(405);
  });

  it("returns 401 when Bearer token is wrong (no x-vercel-cron)", async () => {
    const { GET } = await loadRemind();
    const res = await GET(makeGetRequest("/api/crons/remind", "wrong-secret"));
    expect(res.status).toBe(401);
  });
});

describe("/api/crons/cancel-expired-orders GET", () => {
  it("returns 401 (not 405) with no Authorization header", async () => {
    const { GET } = await loadCancelExpired();
    const res = await GET(makeGetRequest("/api/crons/cancel-expired-orders"));
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(405);
  });

  it("does NOT return 405 with correct Bearer (no x-vercel-cron)", async () => {
    const { GET } = await loadCancelExpired();
    const res = await GET(makeGetRequest("/api/crons/cancel-expired-orders", CRON_SECRET));
    expect(res.status).not.toBe(405);
  });
});

describe("/api/crons/delete-old-histories GET", () => {
  it("returns 401 (not 405) with no Authorization header", async () => {
    const { GET } = await loadDeleteHistories();
    const res = await GET(makeGetRequest("/api/crons/delete-old-histories"));
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(405);
  });

  it("does NOT return 405 with correct Bearer (no x-vercel-cron)", async () => {
    const { GET } = await loadDeleteHistories();
    const res = await GET(makeGetRequest("/api/crons/delete-old-histories", CRON_SECRET));
    expect(res.status).not.toBe(405);
  });
});

describe("remind schedule", () => {
  it("uses the free GitHub daily scheduler and follows reminder cursors", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const vercelJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf-8")
    ) as { crons?: Array<{ path: string; schedule: string }> };
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/production-daily-maintenance.yml"),
      "utf-8",
    );
    expect(vercelJson.crons).toBeUndefined();
    expect(workflow).toContain('cron: "17 18,19,20 * * *"');
    expect(workflow).toContain("while (( reminder_pages < 4 ))");
    expect(workflow).toContain("nextCursor");
  });
});
