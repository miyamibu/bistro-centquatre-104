import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
    rpc: vi.fn(),
  },
}));

type QueryChain = PromiseLike<unknown> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
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
});
