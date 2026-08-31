import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());
const getRequestIdMock = vi.hoisted(() => vi.fn(() => "receipt-request"));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

vi.mock("@/lib/logger", () => ({
  getRequestId: getRequestIdMock,
  logError: logErrorMock,
}));

type QueryChain = PromiseLike<unknown> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function query(result: unknown): QueryChain {
  const chain = {} as QueryChain;
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  });
  return chain;
}

const orderId = "123e4567-e89b-12d3-a456-426614174000";
const receiptToken = "receipt-test-token";

function request(token = receiptToken) {
  return new NextRequest(`http://localhost:3000/api/orders/${orderId}/receipt`, {
    headers: { "X-Order-Receipt-Token": token },
  });
}

function loadQueries() {
  fromMock
    .mockReturnValueOnce(
      query({
        data: {
          order_id: orderId,
          expires_at: "2099-01-01T00:00:00.000Z",
        },
        error: null,
      }),
    )
    .mockReturnValueOnce(
      query({
        data: {
          id: orderId,
          payment_method: "BANK_TRANSFER",
          store_visit_date: null,
          status: "PENDING_PAYMENT",
        },
        error: null,
      }),
    )
    .mockReturnValueOnce(
      query({
        data: {
          status: "SENT",
          customer_sent_at: "2099-01-01T00:00:00.000Z",
        },
        error: null,
      }),
    );
}

async function getReceipt(token = receiptToken) {
  const { GET } = await import("@/app/api/orders/[id]/receipt/route");
  return GET(request(token), { params: Promise.resolve({ id: orderId }) });
}

beforeEach(() => {
  vi.resetModules();
  fromMock.mockReset();
  logErrorMock.mockReset();
  getRequestIdMock.mockReturnValue("receipt-request");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/orders/[id]/receipt", () => {
  it("returns the server-backed completion receipt for a valid token", async () => {
    loadQueries();

    const response = await getReceipt();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      orderId,
      paymentMethod: "BANK_TRANSFER",
      notificationStatus: "SENT",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(fromMock).toHaveBeenCalledTimes(3);
  });

  it("does not query order data for an invalid receipt token", async () => {
    const response = await getReceipt("invalid.token");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "ORDER_RECEIPT_NOT_FOUND" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("does not accept a receipt bearer token from the URL query", async () => {
    const { GET } = await import("@/app/api/orders/[id]/receipt/route");
    const queryOnlyRequest = new NextRequest(
      `http://localhost:3000/api/orders/${orderId}/receipt?receipt_token=${receiptToken}`,
    );

    const response = await GET(queryOnlyRequest, {
      params: Promise.resolve({ id: orderId }),
    });

    expect(response.status).toBe(404);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("does not disclose an expired receipt token", async () => {
    fromMock.mockReturnValueOnce(
      query({
        data: {
          order_id: orderId,
          expires_at: "2020-01-01T00:00:00.000Z",
        },
        error: null,
      }),
    );

    const response = await getReceipt();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "ORDER_RECEIPT_NOT_FOUND" });
    expect(fromMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when receipt storage is unavailable", async () => {
    fromMock.mockReturnValueOnce(
      query({ data: null, error: { message: "storage unavailable" } }),
    );

    const response = await getReceipt();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORDER_RECEIPT_LOOKUP_UNAVAILABLE",
    });
    expect(logErrorMock).toHaveBeenCalledWith(
      "orders.receipt.token_lookup_failed",
      expect.objectContaining({ context: { orderId } }),
    );
    expect(logErrorMock.mock.calls[0]?.[1]).not.toHaveProperty("receiptToken");
  });
});
