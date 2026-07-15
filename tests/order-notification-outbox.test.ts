import { afterEach, describe, expect, it, vi } from "vitest";

const sendOrderConfirmationEmailMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

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

type QueryChain = PromiseLike<unknown> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
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
    in: vi.fn(() => chain),
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

afterEach(() => {
  vi.clearAllMocks();
});

describe("processOrderConfirmationOutboxForOrder", () => {
  it("includes stale PROCESSING rows in the claimable outbox filter", async () => {
    const pendingQuery = query({ data: [], error: null });
    fromMock.mockReturnValueOnce(pendingQuery);

    const { processOrderConfirmationOutboxForOrder } = await import(
      "@/lib/order-notification-outbox"
    );
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-1",
    });

    expect(result).toMatchObject({ processed: false, sent: false, reason: "NO_PENDING_OUTBOX" });
    expect(pendingQuery.or).toHaveBeenCalledWith(
      expect.stringContaining("and(status.eq.PROCESSING,last_attempt_at.lt.")
    );
    expect(pendingQuery.or).toHaveBeenCalledWith(
      expect.stringContaining("error_code.is.null")
    );
  });

  it("marks a claimed outbox row FAILED when order email delivery throws", async () => {
    const pendingQuery = query({
      data: [{ id: "outbox-1", order_id: "order-1", attempts: 0 }],
      error: null,
    });
    const claimQuery = query({ data: [{ id: "outbox-1" }], error: null });
    const orderQuery = query({
      data: {
        id: "order-1",
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
    const markFailedQuery = query({ data: null, error: null });

    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(orderQuery)
      .mockReturnValueOnce(markFailedQuery);
    sendOrderConfirmationEmailMock.mockRejectedValueOnce(new Error("provider unavailable"));

    const { processOrderConfirmationOutboxForOrder } = await import(
      "@/lib/order-notification-outbox"
    );
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-1",
    });

    expect(result).toMatchObject({
      processed: true,
      sent: false,
      reason: "ORDER_CONFIRMATION_EMAIL_THROWN",
    });
    expect(markFailedQuery.update).toHaveBeenCalledWith({
      status: "FAILED",
      error_code: "ORDER_CONFIRMATION_EMAIL_THROWN",
    });
  });

  it("does not leave a delivered email in retryable PROCESSING state when mark SENT fails", async () => {
    const pendingQuery = query({
      data: [{ id: "outbox-1", order_id: "order-1", attempts: 0 }],
      error: null,
    });
    const claimQuery = query({ data: [{ id: "outbox-1" }], error: null });
    const orderQuery = query({
      data: {
        id: "order-1",
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
    const markSentQuery = query({ data: null, error: { message: "write failed" } });
    const reconcileQuery = query({ data: null, error: null });

    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(orderQuery)
      .mockReturnValueOnce(markSentQuery)
      .mockReturnValueOnce(reconcileQuery);
    sendOrderConfirmationEmailMock.mockResolvedValueOnce({
      sent: true,
      provider: "resend",
      adminSent: true,
    });

    const { processOrderConfirmationOutboxForOrder } = await import(
      "@/lib/order-notification-outbox"
    );
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-1",
    });

    expect(result).toMatchObject({
      processed: true,
      sent: true,
      reason: "MARK_SENT_FAILED",
      durableState: true,
    });
    expect(reconcileQuery.update).toHaveBeenCalledWith({
      status: "SENT",
      sent_at: expect.any(String),
      error_code: "ORDER_NOTIFICATION_OUTBOX_MARK_SENT_FAILED",
    });
  });

  it("reports non-durable delivery and excludes it from normal stale retry when reconciliation fails", async () => {
    const pendingQuery = query({
      data: [{ id: "outbox-1", order_id: "order-1", attempts: 0, error_code: null }],
      error: null,
    });
    const claimQuery = query({ data: [{ id: "outbox-1" }], error: null });
    const orderQuery = query({
      data: {
        id: "order-1",
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
    const markSentQuery = query({ data: null, error: { message: "write failed" } });
    const reconcileQuery = query({ data: null, error: { message: "reconcile failed" } });

    fromMock
      .mockReturnValueOnce(pendingQuery)
      .mockReturnValueOnce(claimQuery)
      .mockReturnValueOnce(orderQuery)
      .mockReturnValueOnce(markSentQuery)
      .mockReturnValueOnce(reconcileQuery);
    sendOrderConfirmationEmailMock.mockResolvedValueOnce({
      sent: true,
      provider: "resend",
      adminSent: true,
    });

    const { processOrderConfirmationOutboxForOrder } = await import(
      "@/lib/order-notification-outbox"
    );
    const result = await processOrderConfirmationOutboxForOrder({
      orderId: "order-1",
      requestId: "req-1",
    });

    expect(result).toMatchObject({
      processed: true,
      sent: true,
      reason: "MARK_SENT_FAILED",
      durableState: false,
    });
    expect(pendingQuery.or).toHaveBeenCalledWith(expect.stringContaining("error_code.is.null"));
    expect(claimQuery.or).toHaveBeenCalledWith(expect.stringContaining("error_code.is.null"));
  });
});
