import { beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingleMock = vi.fn();
const upsertMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((table: string) => {
      if (table === "orders") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: maybeSingleMock,
            })),
          })),
        };
      }

      if (table === "order_history") {
        return {
          upsert: upsertMock,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  },
}));

const baseOrder = {
  id: "order-1",
  customer_name: "Taro",
  email: "taro@example.com",
  phone: "09000000000",
  zip_code: "100-0001",
  prefecture: "東京都",
  city: "千代田区",
  address: "1-1-1",
  building: null,
  payment_method: "BANK_TRANSFER" as const,
  payment_reference: "12345678",
  items: [{ id: "item-1", name: "Soup", price: 1000, quantity: 1 }],
  total: 1000,
  store_visit_date: null,
  status: "PENDING_PAYMENT",
  paid_at: null,
  shipped_at: null,
  canceled_at: null,
  cancel_reason: null,
  version: 3,
  created_at: "2026-04-01T00:00:00.000Z",
};

beforeEach(() => {
  maybeSingleMock.mockReset();
  upsertMock.mockReset();
});

describe("order_history lifecycle", () => {
  it("builds a record only for terminal statuses", async () => {
    const { toOrderHistoryRecord } = await import("@/lib/order-history");

    expect(toOrderHistoryRecord(baseOrder)).toBeNull();

    const cancelled = toOrderHistoryRecord({
      ...baseOrder,
      status: "CANCELLED",
      canceled_at: "2026-04-02T00:00:00.000Z",
      cancel_reason: "EXPIRED_PAYMENT",
    });

    expect(cancelled).toMatchObject({
      id: "order-1",
      status: "CANCELLED",
      deleted_at: "2026-04-02T00:00:00.000Z",
    });
  });

  it("archives terminal order rows with idempotent upsert", async () => {
    const { archiveOrderHistoryByOrderId } = await import("@/lib/order-history");

    maybeSingleMock.mockResolvedValue({
      data: {
        ...baseOrder,
        status: "SHIPPED",
        shipped_at: "2026-04-03T00:00:00.000Z",
      },
      error: null,
    });
    upsertMock.mockResolvedValue({ error: null });

    const result = await archiveOrderHistoryByOrderId({
      orderId: "order-1",
      source: "admin",
      requestId: "req-1",
    });

    expect(result).toMatchObject({ archived: true, status: "SHIPPED" });
    expect(upsertMock).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "order-1", status: "SHIPPED" })],
      expect.objectContaining({ onConflict: "id", ignoreDuplicates: true })
    );
  });
});
