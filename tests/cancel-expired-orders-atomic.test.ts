import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const atomicActionMock = vi.hoisted(() => vi.fn());
const buildHashMock = vi.hoisted(() => vi.fn(() => "cron-request-hash"));
const getRequestIdMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: fromMock },
}));

vi.mock("@/lib/env", () => ({
  env: { CRON_SECRET: "cron-secret" },
}));

vi.mock("@/lib/api-security", () => ({
  apiError: (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    }),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (payload: Record<string, unknown>, init: ResponseInit = {}) =>
      new Response(JSON.stringify(payload), {
        ...init,
        headers: { "content-type": "application/json" },
      }),
  },
}));

vi.mock("@/lib/order-actions", () => ({
  buildIdempotencyHash: buildHashMock,
  executeAtomicTerminalOrderAction: atomicActionMock,
  OrderActionError: class OrderActionError extends Error {
    status = 500;
    code = "CRON_CANCEL_FAILED";
  },
}));

vi.mock("@/lib/logger", () => ({
  getRequestId: getRequestIdMock,
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@/lib/scheduler-heartbeat", () => ({
  readSchedulerContext: vi.fn(() => ({ schedulerKind: "API_CRON", runId: null })),
  markSchedulerStarted: vi.fn().mockResolvedValue(undefined),
  markSchedulerSucceeded: vi.fn().mockResolvedValue(undefined),
  markSchedulerFailed: vi.fn().mockResolvedValue(undefined),
}));

type QueryChain = {
  select: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  lt: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

function query(result: unknown) {
  const chain = {} as QueryChain;
  Object.assign(chain, {
    select: vi.fn(() => chain),
    is: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(result)),
  });
  return chain;
}

const expiredQuotedOrder = {
  id: "order-1",
  version: 3,
  status: "QUOTED",
  hold_expires_at: "2026-07-30T00:00:00.000Z",
  expires_at: null,
  canceled_at: null,
};

function request() {
  return new Request("http://localhost:3000/api/crons/cancel-expired-orders", {
    headers: { authorization: "Bearer cron-secret" },
  }) as NextRequest;
}

beforeEach(() => {
  fromMock.mockReset();
  atomicActionMock.mockReset();
  buildHashMock.mockClear();
  getRequestIdMock.mockReset();
});

describe("cancel-expired-orders atomic action path", () => {
  it("uses the atomic CANCEL RPC for an expired order", async () => {
    getRequestIdMock.mockReturnValue("cron-run-1");
    fromMock
      .mockReturnValueOnce(query({ data: [expiredQuotedOrder], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }));
    atomicActionMock.mockResolvedValue({
      status: 200,
      body: { ok: true },
      replayed: false,
    });

    const { GET } = await import("@/app/api/crons/cancel-expired-orders/route");
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cancelledCount: 1,
      failedCount: 0,
    });
    expect(atomicActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "POST:/api/crons/cancel-expired-orders:CANCEL",
        actorKey: "cron",
        action: "CANCEL",
        orderId: "order-1",
        expectedVersion: 3,
        reasonCode: "EXPIRED_HOLD",
        idempotencyKey: "cron:cron-run-1:order-1:EXPIRED_HOLD",
      })
    );
  });

  it("leaves a failed atomic run retryable for the next cron invocation", async () => {
    getRequestIdMock.mockReturnValueOnce("cron-run-1").mockReturnValueOnce("cron-run-2");
    atomicActionMock
      .mockResolvedValueOnce({
        status: 500,
        body: { ok: false, code: "TERMINAL_ORDER_ACTION_FAILED" },
        replayed: false,
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { ok: true },
        replayed: false,
      });

    const { GET } = await import("@/app/api/crons/cancel-expired-orders/route");

    fromMock
      .mockReturnValueOnce(query({ data: [expiredQuotedOrder], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }));
    const first = await GET(request());
    expect(first.status).toBe(500);
    await expect(first.json()).resolves.toMatchObject({ failedCount: 1 });

    fromMock
      .mockReturnValueOnce(query({ data: [expiredQuotedOrder], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(query({ data: [], error: null }));
    const second = await GET(request());
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ cancelledCount: 1 });

    expect(atomicActionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: "cron:cron-run-2:order-1:EXPIRED_HOLD",
      })
    );
  });
});
