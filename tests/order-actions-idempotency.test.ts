import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const randomUUIDMock = vi.hoisted(() => vi.fn(() => "claim-token-1"));

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return { ...actual, randomUUID: randomUUIDMock };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
    rpc: rpcMock,
  },
}));

type QueryChain = PromiseLike<unknown> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function query(result: unknown): QueryChain {
  const chain = {} as QueryChain;
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    single: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  });
  return chain;
}

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  randomUUIDMock.mockReset();
  randomUUIDMock.mockReturnValue("claim-token-1");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runIdempotentMutation unknown outcomes", () => {
  it("keeps the claimed row when execute throws a non-OrderActionError", async () => {
    const lookup = query({ data: null, error: null });
    const claim = query({
      data: {
        id: "claim-1",
        request_hash: "hash-1",
        response_status: null,
        response_body: null,
        claim_expires_at: "2026-07-28T08:05:00.000Z",
        claim_token: "claim-token-1",
      },
      error: null,
    });
    fromMock.mockReturnValueOnce(lookup).mockReturnValueOnce(claim);

    const { runIdempotentMutation } = await import("@/lib/order-actions");
    await expect(
      runIdempotentMutation({
        scope: "POST:/api/orders",
        actorKey: "actor-1",
        idempotencyKey: "key-1",
        requestHash: "hash-1",
        execute: async () => {
          throw new Error("unknown outcome");
        },
      }),
    ).rejects.toThrow("unknown outcome");

    expect(fromMock).toHaveBeenCalledTimes(2);
    expect(claim.delete).not.toHaveBeenCalled();
  });

  it("blocks a matching key whose retained claim is still in progress", async () => {
    const lookup = query({
      data: {
        id: "claim-1",
        request_hash: "hash-1",
        response_status: null,
        response_body: null,
        claim_expires_at: "2099-01-01T00:00:00.000Z",
        claim_token: "another-worker",
      },
      error: null,
    });
    fromMock.mockReturnValueOnce(lookup);
    const execute = vi.fn();

    const { runIdempotentMutation } = await import("@/lib/order-actions");
    const result = await runIdempotentMutation({
      scope: "POST:/api/orders",
      actorKey: "actor-1",
      idempotencyKey: "key-1",
      requestHash: "hash-1",
      execute,
    });

    expect(result).toMatchObject({
      status: 409,
      body: { code: "IDEMPOTENCY_IN_PROGRESS" },
      replayed: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("reclaims an expired lease once and fences finalization to that new claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T08:00:00.000Z"));
    const lookup = query({
      data: {
        id: "claim-1",
        request_hash: "hash-1",
        response_status: null,
        response_body: null,
        claim_expires_at: "2026-07-28T07:59:59.999Z",
        claim_token: "expired-worker",
      },
      error: null,
    });
    const reclaim = query({
      data: {
        id: "claim-1",
        request_hash: "hash-1",
        response_status: null,
        response_body: null,
        claim_expires_at: "2026-07-28T08:05:00.000Z",
        claim_token: "claim-token-1",
      },
      error: null,
    });
    const finalize = query({ data: { id: "claim-1" }, error: null });
    fromMock.mockReturnValueOnce(lookup).mockReturnValueOnce(reclaim).mockReturnValueOnce(finalize);

    const { runIdempotentMutation } = await import("@/lib/order-actions");
    const result = await runIdempotentMutation({
      scope: "POST:/api/orders",
      actorKey: "actor-1",
      idempotencyKey: "key-1",
      requestHash: "hash-1",
      execute: async () => ({ ok: true }),
    });

    expect(result).toMatchObject({ status: 200, replayed: false });
    expect(reclaim.or).toHaveBeenCalledWith(
      "and(response_status.is.null,response_body.is.null,claim_expires_at.is.null)," +
        "and(response_status.is.null,response_body.is.null,claim_expires_at.lte.2026-07-28T08:00:00.000Z)"
    );
    expect(finalize.eq.mock.calls).toEqual([
      ["id", "claim-1"],
      ["claim_token", "claim-token-1"],
    ]);
  });
});

describe("executeAtomicTerminalOrderAction contract", () => {
  const baseInput = {
    scope: "POST:/api/orders/{id}/actions:MARK_SHIPPED",
    actorKey: "admin",
    requestHash: "request-hash-1",
    orderId: "order-1",
    expectedVersion: 4,
    action: "MARK_SHIPPED" as const,
    actorType: "admin" as const,
    actorId: "admin",
    requestId: "request-1",
    idempotencyKey: "key-1",
    adminNote: "packed",
  };

  it.each([
    ["MARK_SHIPPED" as const, undefined],
    ["CANCEL" as const, "EXPIRED_PAYMENT"],
  ])("passes %s through the atomic RPC boundary", async (action, reasonCode) => {
    rpcMock.mockResolvedValue({
      data: {
        status: 200,
        body: { ok: true, order: { id: "order-1", status: action === "CANCEL" ? "CANCELLED" : "SHIPPED" } },
        replayed: false,
      },
      error: null,
    });

    const { executeAtomicTerminalOrderAction } = await import("@/lib/order-actions");
    const result = await executeAtomicTerminalOrderAction({
      ...baseInput,
      action,
      reasonCode,
    });

    expect(result).toMatchObject({ status: 200, replayed: false });
    expect(rpcMock).toHaveBeenCalledWith(
      "execute_terminal_order_action",
      expect.objectContaining({
        p_scope: baseInput.scope,
        p_actor_key: baseInput.actorKey,
        p_idempotency_key: baseInput.idempotencyKey,
        p_request_hash: baseInput.requestHash,
        p_order_id: baseInput.orderId,
        p_expected_version: baseInput.expectedVersion,
        p_action: action,
        p_reason_code: reasonCode ?? null,
        p_actor_type: baseInput.actorType,
        p_actor_id: baseInput.actorId,
        p_request_id: baseInput.requestId,
      })
    );
  });

  it("returns the durable replay result without a client-side second mutation", async () => {
    rpcMock.mockResolvedValue({
      data: {
        status: 200,
        body: { ok: true, order: { id: "order-1", status: "SHIPPED" } },
        replayed: true,
      },
      error: null,
    });

    const { executeAtomicTerminalOrderAction } = await import("@/lib/order-actions");
    const result = await executeAtomicTerminalOrderAction(baseInput);

    expect(result).toMatchObject({ status: 200, replayed: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it.each([
    [409, "IDEMPOTENCY_CONFLICT"],
    [409, "VERSION_CONFLICT"],
  ])("preserves an atomic %s response for %s", async (status, code) => {
    rpcMock.mockResolvedValue({
      data: {
        status,
        body: { ok: false, error: code, code },
        replayed: false,
      },
      error: null,
    });

    const { executeAtomicTerminalOrderAction } = await import("@/lib/order-actions");
    const result = await executeAtomicTerminalOrderAction(baseInput);

    expect(result).toMatchObject({ status, body: { code }, replayed: false });
  });

  it("surfaces an RPC transaction failure without attempting a separate finalize or history write", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "TERMINAL_ORDER_ACTION_FAILED" },
    });

    const { executeAtomicTerminalOrderAction } = await import("@/lib/order-actions");
    await expect(executeAtomicTerminalOrderAction(baseInput)).rejects.toMatchObject({
      status: 500,
      code: "TERMINAL_ORDER_ACTION_FAILED",
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("executeAtomicOrderMutation contract", () => {
  const baseInput = {
    scope: "POST:/api/orders/{id}/actions:MARK_PAID",
    actorKey: "staff:admin-1",
    idempotencyKey: "key-1",
    requestHash: "hash-1",
    operation: "MARK_PAID" as const,
    mutationArgs: {
      orderId: "order-1",
      expectedVersion: 2,
      paymentReference: "12345678",
      receivedAmount: 5000,
      actorType: "admin",
      actorId: "staff:admin-1",
      requestId: "request-1",
    },
  };

  it("sends claim, mutation, and final response through one RPC", async () => {
    rpcMock.mockResolvedValue({
      data: {
        status: 200,
        body: { ok: true, order: { id: "order-1", status: "PAID" } },
        replayed: false,
      },
      error: null,
    });

    const { executeAtomicOrderMutation } = await import("@/lib/order-actions");
    const result = await executeAtomicOrderMutation(baseInput);

    expect(result).toMatchObject({ status: 200, replayed: false });
    expect(rpcMock).toHaveBeenCalledWith("execute_atomic_order_mutation", {
      p_scope: baseInput.scope,
      p_actor_key: baseInput.actorKey,
      p_idempotency_key: baseInput.idempotencyKey,
      p_request_hash: baseInput.requestHash,
      p_operation: baseInput.operation,
      p_mutation_args: baseInput.mutationArgs,
      p_response_context: {},
      p_success_status: 200,
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns a durable replay without a second client-side mutation", async () => {
    rpcMock.mockResolvedValue({
      data: {
        status: 201,
        body: { ok: true, order: { id: "order-1" } },
        replayed: true,
      },
      error: null,
    });

    const { executeAtomicOrderMutation } = await import("@/lib/order-actions");
    const result = await executeAtomicOrderMutation({ ...baseInput, successStatus: 201 });

    expect(result).toMatchObject({ status: 201, replayed: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
