import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  fromMock.mockReset();
  sendOrderConfirmationEmailMock.mockReset();
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
      expect.stringContaining("next_attempt_at.is.null,next_attempt_at.lte.")
    );
  });

  it("marks a claimed outbox row FAILED when order email delivery throws", async () => {
    const pendingQuery = query({
      data: [
        {
          id: "outbox-1",
          order_id: "order-1",
          notification_type: "ORDER_CONFIRMATION",
          attempts: 0,
          max_attempts: 5,
        },
      ],
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
      reason: "ORDER_NOTIFICATION_FAILED",
    });
    expect(markFailedQuery.update).toHaveBeenCalledWith({
      status: "PENDING",
      attempts: 1,
      next_attempt_at: expect.any(String),
      locked_until: null,
      last_error: "provider unavailable",
    });
  });

  it("does not leave a delivered email in retryable PROCESSING state when mark SENT fails", async () => {
    const pendingQuery = query({
      data: [
        {
          id: "outbox-1",
          order_id: "order-1",
          notification_type: "ORDER_CONFIRMATION",
          attempts: 0,
          max_attempts: 5,
        },
      ],
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
      sent: false,
      reason: "ORDER_NOTIFICATION_FAILED",
      durableState: true,
    });
    expect(reconcileQuery.update).toHaveBeenCalledWith({
      status: "PENDING",
      attempts: 1,
      next_attempt_at: expect.any(String),
      locked_until: null,
      last_error: expect.stringContaining("ORDER_NOTIFICATION_OUTBOX_MARK_SENT_FAILED"),
    });
  });

  it("reports non-durable delivery and excludes it from normal stale retry when reconciliation fails", async () => {
    const pendingQuery = query({
      data: [
        {
          id: "outbox-1",
          order_id: "order-1",
          notification_type: "ORDER_CONFIRMATION",
          attempts: 0,
          max_attempts: 5,
        },
      ],
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
      sent: false,
      reason: "MARK_FAILED_FAILED",
      durableState: false,
    });
    expect(pendingQuery.or).toHaveBeenCalledWith(
      expect.stringContaining("next_attempt_at.is.null,next_attempt_at.lte.")
    );
  });
});
