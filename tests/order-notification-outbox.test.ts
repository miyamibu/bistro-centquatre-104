import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendOrderConfirmationEmailMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
const randomUUIDMock = vi.hoisted(() => vi.fn(() => "claim-token-1"));

vi.mock("@/lib/email", () => ({
  sendOrderConfirmationEmail: sendOrderConfirmationEmailMock,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("node:crypto", () => ({
  randomUUID: randomUUIDMock,
}));

type QueryChain = PromiseLike<unknown> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function query(result: unknown) {
  const chain = {} as QueryChain;
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    update: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject),
  });

  return chain;
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-1",
    order_id: "order-1",
    notification_type: "ORDER_CONFIRMATION",
    attempts: 0,
    max_attempts: 5,
    claim_token: null,
    customer_sent_at: null,
    admin_sent_at: null,
    admin_skipped_at: null,
    ...overrides,
  };
}

function orderQuery() {
  return query({
    data: {
      id: "order-1",
      status: "PENDING_PAYMENT",
      customer_name: "Taro",
      email: "taro@example.com",
      phone: "09000000000",
      zip_code: "100-0001",
      prefecture: "Tokyo",
      city: "Chiyoda",
      address: "1-1",
      building: null,
      items: [{ id: "item-1", name: "Soup", price: 1000, quantity: 1 }],
      total: 1000,
      payment_method: "PAY_IN_STORE",
      store_visit_date: "2026-09-24",
    },
    error: null,
  });
}

async function loadProcessor() {
  return import("@/lib/order-notification-outbox");
}

beforeEach(() => {
  vi.resetModules();
  fromMock.mockReset();
  sendOrderConfirmationEmailMock.mockReset();
  randomUUIDMock.mockReset();
  randomUUIDMock.mockReturnValue("claim-token-1");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("processOrderConfirmationOutboxForOrder", () => {
  it("dead-letters a cancelled order confirmation without sending", async () => {
    const pendingQuery = query({ data: [baseRow()], error: null });
    const claimQuery = query({ data: { id: "outbox-1", claim_token: "claim-token-1" }, error: null });
    const suppressQuery = query({ data: { id: "outbox-1" }, error: null });
    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(query({ data: { id: "order-1", status: "CANCELLED" }, error: null }))
      .mockReturnValueOnce(suppressQuery);

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-cancelled",
    });

    expect(result).toMatchObject({
      processed: true,
      sent: false,
      reason: "ORDER_CANCELLED",
      durableState: true,
    });
    expect(sendOrderConfirmationEmailMock).not.toHaveBeenCalled();
    expect(suppressQuery.update).toHaveBeenCalledWith({
      status: "DEAD_LETTER",
      locked_until: null,
      claim_token: null,
      last_error: "ORDER_CANCELLED",
    });
    expect(suppressQuery.update.mock.calls[0]?.[0]).not.toHaveProperty("next_attempt_at");
  });
  it("uses the same due-or-expired condition when selecting claimable rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T08:00:00.000Z"));
    const pendingQuery = query({ data: [], error: null });
    fromMock.mockReturnValueOnce(pendingQuery);

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-1",
    });

    expect(result).toMatchObject({ processed: false, sent: false, reason: "NO_PENDING_OUTBOX" });
    expect(pendingQuery.or).toHaveBeenCalledWith(
      "and(status.eq.PENDING,next_attempt_at.is.null)," +
        "and(status.eq.PENDING,next_attempt_at.lte.2026-07-28T08:00:00.000Z)," +
        "and(status.eq.PROCESSING,locked_until.lte.2026-07-28T08:00:00.000Z)"
    );
  });

  it("does not reclaim an active PROCESSING lock when the atomic claim matches no row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T08:00:00.000Z"));
    const pendingQuery = query({
      data: [
        baseRow({
          id: "outbox-active",
          status: "PROCESSING",
          locked_until: "2026-07-28T08:05:00.000Z",
        }),
      ],
      error: null,
    });
    const claimQuery = query({ data: null, error: null });
    fromMock.mockReturnValueOnce(pendingQuery).mockReturnValueOnce(claimQuery);

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-active",
    });

    expect(result).toMatchObject({
      processed: false,
      sent: false,
      reason: "CLAIM_SKIPPED",
      durableState: false,
    });
    expect(sendOrderConfirmationEmailMock).not.toHaveBeenCalled();
    expect(claimQuery.update).toHaveBeenCalledWith({
      status: "PROCESSING",
      claimed_at: "2026-07-28T08:00:00.000Z",
      locked_until: "2026-07-28T08:05:00.000Z",
      last_error: null,
      request_id: "req-active",
      claim_token: "claim-token-1",
    });
  });

  it("rejects a claim response whose token is not the token written by this worker", async () => {
    const pendingQuery = query({ data: [baseRow()], error: null });
    const claimQuery = query({ data: { id: "outbox-1", claim_token: "another-worker" }, error: null });
    fromMock.mockReturnValueOnce(pendingQuery).mockReturnValueOnce(claimQuery);

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-claim-mismatch",
    });

    expect(result).toMatchObject({ reason: "CLAIM_SKIPPED", durableState: false });
    expect(sendOrderConfirmationEmailMock).not.toHaveBeenCalled();
  });

  it("reclaims an expired PROCESSING lock and fences every state update with the claim token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T08:00:00.000Z"));
    const pendingQuery = query({
      data: [
        baseRow({
          id: "outbox-expired",
          status: "PROCESSING",
          locked_until: "2026-07-28T07:59:59.999Z",
        }),
      ],
      error: null,
    });
    const claimQuery = query({ data: { id: "outbox-expired", claim_token: "claim-token-1" }, error: null });
    const customerStateQuery = query({ data: { id: "outbox-expired" }, error: null });
    const adminStateQuery = query({ data: { id: "outbox-expired" }, error: null });
    const markSentQuery = query({ data: { id: "outbox-expired" }, error: null });

    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(orderQuery())
      .mockReturnValueOnce(customerStateQuery)
      .mockReturnValueOnce(adminStateQuery)
      .mockReturnValueOnce(markSentQuery);
    sendOrderConfirmationEmailMock
      .mockResolvedValueOnce({ sent: true, provider: "resend", adminSent: false })
      .mockResolvedValueOnce({ sent: true, provider: "resend", adminSent: true });

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-expired",
    });

    expect(result).toMatchObject({
      processed: true,
      sent: true,
      reason: "SENT",
      durableState: true,
    });
    expect(claimQuery.select).toHaveBeenCalledWith("id, claim_token");
    expect(customerStateQuery.eq.mock.calls).toEqual([
      ["id", "outbox-expired"],
      ["claim_token", "claim-token-1"],
      ["status", "PROCESSING"],
    ]);
    expect(adminStateQuery.eq.mock.calls).toEqual([
      ["id", "outbox-expired"],
      ["claim_token", "claim-token-1"],
      ["status", "PROCESSING"],
    ]);
    expect(markSentQuery.eq.mock.calls).toEqual([
      ["id", "outbox-expired"],
      ["claim_token", "claim-token-1"],
      ["status", "PROCESSING"],
    ]);
    expect(markSentQuery.update).toHaveBeenCalledWith({
      status: "SENT",
      sent_at: expect.any(String),
      locked_until: null,
      claim_token: null,
      last_error: null,
    });
    expect(markSentQuery.update.mock.calls[0]?.[0]).not.toHaveProperty("next_attempt_at");
    expect(sendOrderConfirmationEmailMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.any(Array),
      1000,
      "PAY_IN_STORE",
      "2026-09-24",
      undefined,
      { target: "customer", idempotencyKey: "order-outbox/outbox-expired" }
    );
    expect(sendOrderConfirmationEmailMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.any(Array),
      1000,
      "PAY_IN_STORE",
      "2026-09-24",
      undefined,
      { target: "admin", idempotencyKey: "order-outbox/outbox-expired" }
    );
  });

  it("persists customer success before an admin failure so the next retry sends only admin", async () => {
    const pendingQuery = query({ data: [baseRow()], error: null });
    const claimQuery = query({ data: { id: "outbox-1", claim_token: "claim-token-1" }, error: null });
    const customerStateQuery = query({ data: { id: "outbox-1" }, error: null });
    const markFailedQuery = query({ data: { id: "outbox-1" }, error: null });
    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(orderQuery())
      .mockReturnValueOnce(customerStateQuery)
      .mockReturnValueOnce(markFailedQuery);
    sendOrderConfirmationEmailMock
      .mockResolvedValueOnce({ sent: true, provider: "resend", adminSent: false })
      .mockResolvedValueOnce({ sent: false, reason: "SEND_FAILED", target: "admin", provider: "resend" });

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const firstResult = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-partial-1",
    });

    expect(firstResult).toMatchObject({
      processed: true,
      sent: false,
      reason: "ORDER_NOTIFICATION_FAILED",
      durableState: true,
    });
    expect(markFailedQuery.update).toHaveBeenCalledWith({
      status: "PENDING",
      attempts: 1,
      next_attempt_at: expect.any(String),
      locked_until: null,
      claim_token: null,
      last_error: "ORDER_NOTIFICATION_FAILED:SEND_FAILED",
    });

    const retryPendingQuery = query({
      data: [baseRow({ customer_sent_at: "2026-07-28T08:00:01.000Z" })],
      error: null,
    });
    const retryClaimQuery = query({ data: { id: "outbox-1", claim_token: "claim-token-1" }, error: null });
    const retryAdminStateQuery = query({ data: { id: "outbox-1" }, error: null });
    const retryMarkSentQuery = query({ data: { id: "outbox-1" }, error: null });
    fromMock
      .mockReturnValueOnce(retryPendingQuery)
      .mockReturnValueOnce(retryClaimQuery)
      .mockReturnValueOnce(orderQuery())
      .mockReturnValueOnce(retryAdminStateQuery)
      .mockReturnValueOnce(retryMarkSentQuery);
    sendOrderConfirmationEmailMock.mockResolvedValueOnce({
      sent: true,
      provider: "resend",
      adminSent: true,
    });

    const secondResult = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-partial-2",
    });

    expect(secondResult).toMatchObject({ processed: true, sent: true, reason: "SENT" });
    expect(sendOrderConfirmationEmailMock).toHaveBeenCalledTimes(3);
    expect(sendOrderConfirmationEmailMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.any(Array),
      1000,
      "PAY_IN_STORE",
      "2026-09-24",
      undefined,
      { target: "admin", idempotencyKey: "order-outbox/outbox-1" }
    );
  });

  it("marks a claimed outbox row FAILED with a fenced update when delivery fails", async () => {
    const pendingQuery = query({ data: [baseRow()], error: null });
    const claimQuery = query({ data: { id: "outbox-1", claim_token: "claim-token-1" }, error: null });
    const markFailedQuery = query({ data: { id: "outbox-1" }, error: null });
    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(orderQuery())
      .mockReturnValueOnce(markFailedQuery);
    sendOrderConfirmationEmailMock.mockResolvedValueOnce({
      sent: false,
      reason: "SEND_FAILED",
      target: "customer",
      provider: "resend",
    });

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-failed",
    });

    expect(result).toMatchObject({
      processed: true,
      sent: false,
      reason: "ORDER_NOTIFICATION_FAILED",
      durableState: true,
    });
    expect(markFailedQuery.eq.mock.calls).toEqual([
      ["id", "outbox-1"],
      ["claim_token", "claim-token-1"],
      ["status", "PROCESSING"],
    ]);
  });

  it("dead-letters a terminal delivery failure without writing a nullable retry time", async () => {
    const pendingQuery = query({
      data: [baseRow({ attempts: 4, max_attempts: 5 })],
      error: null,
    });
    const claimQuery = query({ data: { id: "outbox-1", claim_token: "claim-token-1" }, error: null });
    const markFailedQuery = query({ data: { id: "outbox-1" }, error: null });
    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(orderQuery())
      .mockReturnValueOnce(markFailedQuery);
    sendOrderConfirmationEmailMock.mockResolvedValueOnce({
      sent: false,
      reason: "SEND_FAILED",
      target: "customer",
      provider: "resend",
    });

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-dead-letter",
    });

    expect(result).toMatchObject({
      processed: true,
      sent: false,
      reason: "DEAD_LETTER",
      durableState: true,
    });
    expect(markFailedQuery.update).toHaveBeenCalledWith({
      status: "DEAD_LETTER",
      attempts: 5,
      locked_until: null,
      claim_token: null,
      last_error: "ORDER_NOTIFICATION_FAILED:SEND_FAILED",
    });
    expect(markFailedQuery.update.mock.calls[0]?.[0]).not.toHaveProperty("next_attempt_at");
  });

  it("returns durableState false and does not reset the row when a partial-state write loses the claim", async () => {
    const pendingQuery = query({ data: [baseRow()], error: null });
    const claimQuery = query({ data: { id: "outbox-1", claim_token: "claim-token-1" }, error: null });
    const customerStateQuery = query({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(orderQuery())
      .mockReturnValueOnce(customerStateQuery);
    sendOrderConfirmationEmailMock.mockResolvedValueOnce({
      sent: true,
      provider: "resend",
      adminSent: false,
    });

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-claim-lost",
    });

    expect(result).toMatchObject({
      processed: true,
      sent: false,
      reason: "CLAIM_LOST",
      durableState: false,
    });
    expect(fromMock).toHaveBeenCalledTimes(4);
  });

  it("returns durableState false and leaves the row fenced when the mark-failed write loses the claim", async () => {
    const pendingQuery = query({ data: [baseRow()], error: null });
    const claimQuery = query({ data: { id: "outbox-1", claim_token: "claim-token-1" }, error: null });
    const markFailedQuery = query({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(orderQuery())
      .mockReturnValueOnce(markFailedQuery);
    sendOrderConfirmationEmailMock.mockResolvedValueOnce({
      sent: false,
      reason: "SEND_FAILED",
      target: "customer",
      provider: "resend",
    });

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-mark-failed-claim-lost",
    });

    expect(result).toMatchObject({
      processed: true,
      sent: false,
      reason: "MARK_FAILED_FAILED",
      durableState: false,
    });
    expect(markFailedQuery.eq.mock.calls).toEqual([
      ["id", "outbox-1"],
      ["claim_token", "claim-token-1"],
      ["status", "PROCESSING"],
    ]);
  });

  it("does not retry after all providers succeeded when the final SENT write fails", async () => {
    const pendingQuery = query({
      data: [
        baseRow({
          customer_sent_at: "2026-07-28T08:00:01.000Z",
          admin_sent_at: "2026-07-28T08:00:02.000Z",
        }),
      ],
      error: null,
    });
    const claimQuery = query({ data: { id: "outbox-1", claim_token: "claim-token-1" }, error: null });
    const markSentQuery = query({ data: null, error: { message: "write failed" } });
    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(orderQuery())
      .mockReturnValueOnce(markSentQuery);

    const { processOrderConfirmationOutboxForOrder } = await loadProcessor();
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-mark-sent-failed",
    });

    expect(result).toMatchObject({
      processed: true,
      sent: false,
      reason: "DURABILITY_WRITE_FAILED",
      durableState: false,
    });
    expect(sendOrderConfirmationEmailMock).not.toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledTimes(4);
  });
});
