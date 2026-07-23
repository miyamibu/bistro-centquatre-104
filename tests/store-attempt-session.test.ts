import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOrderCreateAttempt,
  clearOrderPaymentAttempt,
  loadOrderCreateAttempt,
  loadOrderPaymentAttempt,
  saveOrderCreateAttempt,
  saveOrderPaymentAttempt,
} from "@/lib/store-attempt-session";

const CREATE_KEY = "bistro.order-create-attempt";
const PAYMENT_KEY = "bistro.order-payment-attempt";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeEach(() => {
  const sessionStorage = createStorage();
  vi.stubGlobal("window", { sessionStorage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("order create attempt marker", () => {
  it("round-trips a marker without storing order payload or PII", () => {
    expect(saveOrderCreateAttempt({ idempotencyKey: "create-key", phase: "submitting" })).toBe(true);
    expect(loadOrderCreateAttempt()).toEqual({
      status: "found",
      attempt: { idempotencyKey: "create-key", phase: "submitting" },
    });
    expect(window.sessionStorage.getItem(CREATE_KEY)).toBe(
      JSON.stringify({ idempotencyKey: "create-key", phase: "submitting" }),
    );
  });

  it("clears only the exact idempotency key", () => {
    saveOrderCreateAttempt({ idempotencyKey: "create-key", phase: "uncertain" });

    expect(clearOrderCreateAttempt("other-key")).toBe(false);
    expect(window.sessionStorage.getItem(CREATE_KEY)).not.toBeNull();
    expect(clearOrderCreateAttempt("create-key")).toBe(true);
    expect(window.sessionStorage.getItem(CREATE_KEY)).toBeNull();
  });

  it("fails closed for invalid JSON and storage exceptions", () => {
    window.sessionStorage.setItem(CREATE_KEY, "not-json");
    expect(loadOrderCreateAttempt()).toEqual({ status: "invalid" });

    const getItem = vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(loadOrderCreateAttempt()).toEqual({ status: "storage-failed" });
    expect(clearOrderCreateAttempt("create-key")).toBe(false);
    getItem.mockRestore();
  });

  it("does not report save success when read-back differs", () => {
    vi.spyOn(window.sessionStorage, "getItem").mockReturnValue("different");
    expect(saveOrderCreateAttempt({ idempotencyKey: "create-key", phase: "submitting" })).toBe(false);
  });

  it("does not send callers past a sessionStorage write exception", () => {
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(saveOrderCreateAttempt({ idempotencyKey: "create-key", phase: "submitting" })).toBe(false);
  });
});

describe("order payment attempt marker", () => {
  it("loads only an exact order ID and leaves a mismatch untouched", () => {
    expect(
      saveOrderPaymentAttempt({
        orderId: "order-1",
        idempotencyKey: "payment-key",
        phase: "submitting",
      }),
    ).toBe(true);

    expect(loadOrderPaymentAttempt("order-2")).toEqual({ status: "mismatch" });
    expect(window.sessionStorage.getItem(PAYMENT_KEY)).not.toBeNull();
    expect(loadOrderPaymentAttempt("order-1")).toEqual({
      status: "found",
      attempt: {
        orderId: "order-1",
        idempotencyKey: "payment-key",
        phase: "submitting",
      },
    });
  });

  it("clears only an exact order ID and idempotency key pair", () => {
    saveOrderPaymentAttempt({
      orderId: "order-1",
      idempotencyKey: "payment-key",
      phase: "uncertain",
    });
    saveOrderPaymentAttempt({
      orderId: "order-2",
      idempotencyKey: "other-payment-key",
      phase: "submitting",
    });

    expect(clearOrderPaymentAttempt("order-2", "payment-key")).toBe(false);
    expect(clearOrderPaymentAttempt("order-1", "other-key")).toBe(false);
    expect(window.sessionStorage.getItem(PAYMENT_KEY)).not.toBeNull();
    expect(clearOrderPaymentAttempt("order-1", "payment-key")).toBe(true);
    expect(loadOrderPaymentAttempt("order-2")).toEqual({
      status: "found",
      attempt: {
        orderId: "order-2",
        idempotencyKey: "other-payment-key",
        phase: "submitting",
      },
    });
  });
});
