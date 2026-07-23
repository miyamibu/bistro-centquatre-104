import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingOrderPaymentSetup,
  loadOrderCompletionReceipt,
  loadPendingOrderPaymentSetup,
  parseServerConfirmedCartItems,
  restoreAndClearPendingOrderCart,
  saveOrderCompletionReceipt,
  savePendingOrderPaymentSetup,
  type PendingOrderPaymentSetup,
} from "@/lib/store-checkout-session";
import { clearCart } from "@/lib/store-cart";
import {
  loadOrderCreateAttempt,
  loadOrderPaymentAttempt,
  saveOrderCreateAttempt,
  saveOrderPaymentAttempt,
} from "@/lib/store-attempt-session";

const STORAGE_KEY = "bistro.pending-order-payment";
const COMPLETION_STORAGE_KEY = "bistro.order-completion";
const CART_STORAGE_KEY = "bistro_store_cart";
const validItems = [
  {
    id: "item-1",
    name: "テスト商品",
    price: 1_200,
    image: "/images/test.jpg",
    quantity: 2,
  },
];
const validSetup: PendingOrderPaymentSetup = {
  orderId: "order-1",
  expectedVersion: 1,
  humanToken: "human-token",
  paymentMethod: "BANK_TRANSFER",
  storeVisitDate: null,
  holdExpiresAt: "2026-07-22T00:00:00.000Z",
  cartItems: validItems,
  quotedTotal: 2_400,
};
const validReceipt = {
  orderId: "order-1",
  paymentMethod: "BANK_TRANSFER" as const,
  storeVisitDate: null,
  notificationStatus: "SENT" as const,
};

function installSessionStorageMock() {
  const createStorage = (): Storage => {
    const values = new Map<string, string>();
    return {
      get length() {
        return values.size;
      },
      clear() {
        values.clear();
      },
      getItem(key) {
        return values.get(key) ?? null;
      },
      key(index) {
        return Array.from(values.keys())[index] ?? null;
      },
      removeItem(key) {
        values.delete(key);
      },
      setItem(key, value) {
        values.set(key, value);
      },
    };
  };

  const sessionStorage = createStorage();
  const localStorage = createStorage();
  vi.stubGlobal("window", { sessionStorage, localStorage });
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("localStorage", localStorage);
}

function writeSetup(value: unknown) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

beforeEach(() => {
  installSessionStorageMock();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("parseServerConfirmedCartItems", () => {
  it("accepts valid server-confirmed items", () => {
    expect(parseServerConfirmedCartItems(validItems)).toEqual(validItems);
  });

  it("rejects an empty item list", () => {
    expect(parseServerConfirmedCartItems([])).toBeNull();
  });

  it("rejects invalid prices and quantities", () => {
    expect(parseServerConfirmedCartItems([{ ...validItems[0], price: 0 }])).toBeNull();
    expect(parseServerConfirmedCartItems([{ ...validItems[0], quantity: 0 }])).toBeNull();
  });
});

describe("loadPendingOrderPaymentSetup", () => {
  it("returns a fully valid setup", () => {
    savePendingOrderPaymentSetup(validSetup);
    expect(loadPendingOrderPaymentSetup("order-1")).toEqual(validSetup);
  });

  it("returns null when cart items are missing", () => {
    writeSetup({ ...validSetup, cartItems: undefined });
    expect(loadPendingOrderPaymentSetup("order-1")).toBeNull();
  });

  it("returns null when the item total does not match the quoted total", () => {
    writeSetup({ ...validSetup, quotedTotal: 2_401 });
    expect(loadPendingOrderPaymentSetup("order-1")).toBeNull();
  });

  it("returns null for an invalid payment method", () => {
    writeSetup({ ...validSetup, paymentMethod: "CREDIT_CARD" });
    expect(loadPendingOrderPaymentSetup("order-1")).toBeNull();
  });

  it.each([undefined, null, ""])("requires an exact non-empty order ID (%s)", (orderId) => {
    savePendingOrderPaymentSetup(validSetup);
    expect(loadPendingOrderPaymentSetup(orderId)).toBeNull();
  });

  it("does not load a different pending order", () => {
    savePendingOrderPaymentSetup(validSetup);
    expect(loadPendingOrderPaymentSetup("order-2")).toBeNull();
  });
});

describe("pending order cart restore and cleanup", () => {
  it("clears only a matching pending order ID", () => {
    savePendingOrderPaymentSetup(validSetup);

    expect(clearPendingOrderPaymentSetup("order-2")).toBe(false);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(clearPendingOrderPaymentSetup("order-1")).toBe(true);
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("keeps the matching setup when sessionStorage silently refuses removal", () => {
    savePendingOrderPaymentSetup(validSetup);
    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(() => undefined);

    expect(clearPendingOrderPaymentSetup("order-1")).toBe(false);
    expect(loadPendingOrderPaymentSetup("order-1")).toEqual(validSetup);
  });

  it("keeps the matching setup when sessionStorage removal throws", () => {
    savePendingOrderPaymentSetup(validSetup);
    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(clearPendingOrderPaymentSetup("order-1")).toBe(false);
    expect(loadPendingOrderPaymentSetup("order-1")).toEqual(validSetup);
  });

  it("reloads, restores, and clears the matching setup as one narrow operation", () => {
    savePendingOrderPaymentSetup(validSetup);

    expect(restoreAndClearPendingOrderCart("order-1")).toBe("restored");
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(validItems));
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clears the snapshot without rewriting an exactly matching current cart", () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(validItems));
    savePendingOrderPaymentSetup(validSetup);
    const setItem = vi.spyOn(window.localStorage, "setItem");

    expect(restoreAndClearPendingOrderCart("order-1")).toBe("already-restored");
    expect(setItem).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not overwrite or clear a different non-empty cart", () => {
    const currentItems = [{ ...validItems[0], id: "other-item" }];
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(currentItems));
    savePendingOrderPaymentSetup(validSetup);

    expect(restoreAndClearPendingOrderCart("order-1")).toBe("conflict");
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(currentItems));
    expect(window.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("keeps the snapshot when localStorage throws", () => {
    savePendingOrderPaymentSetup(validSetup);
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(restoreAndClearPendingOrderCart("order-1")).toBe("storage-failed");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("keeps the snapshot when the restored cart read-back differs", () => {
    savePendingOrderPaymentSetup(validSetup);
    vi.spyOn(window.localStorage, "getItem")
      .mockReturnValueOnce(null)
      .mockReturnValue(JSON.stringify([{ ...validItems[0], quantity: 1 }]));

    expect(restoreAndClearPendingOrderCart("order-1")).toBe("storage-failed");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("does not change cart or session storage for an ID mismatch", () => {
    const currentItems = [{ ...validItems[0], id: "existing" }];
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(currentItems));
    savePendingOrderPaymentSetup(validSetup);

    expect(restoreAndClearPendingOrderCart("order-2")).toBe("missing");
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).toBe(JSON.stringify(currentItems));
    expect(window.sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});

describe("successful response storage ordering", () => {
  it("confirms a completion receipt by exact read-back", () => {
    expect(saveOrderCompletionReceipt(validReceipt)).toBe(true);
    expect(loadOrderCompletionReceipt("order-1")).toEqual(validReceipt);
  });

  it("reports a silent completion receipt mismatch", () => {
    const originalSetItem = window.sessionStorage.setItem.bind(window.sessionStorage);
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation((key, value) => {
      originalSetItem(key, key === COMPLETION_STORAGE_KEY ? `${value}-mismatch` : value);
    });

    expect(saveOrderCompletionReceipt(validReceipt)).toBe(false);
    expect(loadOrderCompletionReceipt("order-1")).toBeNull();
  });

  it("reports a completion receipt storage exception", () => {
    const originalSetItem = window.sessionStorage.setItem.bind(window.sessionStorage);
    vi.spyOn(window.sessionStorage, "setItem").mockImplementation((key, value) => {
      if (key === COMPLETION_STORAGE_KEY) throw new Error("storage blocked");
      originalSetItem(key, value);
    });

    expect(saveOrderCompletionReceipt(validReceipt)).toBe(false);
    expect(window.sessionStorage.getItem(COMPLETION_STORAGE_KEY)).toBeNull();
  });

  it("keeps create marker and pending setup when cart clearing cannot be verified", () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(validItems));
    savePendingOrderPaymentSetup(validSetup);
    saveOrderCreateAttempt({ idempotencyKey: "create-key", phase: "submitting" });
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    vi.spyOn(window.localStorage, "setItem").mockImplementation((key, value) => {
      if (key !== CART_STORAGE_KEY || value !== JSON.stringify([])) {
        originalSetItem(key, value);
      }
    });

    expect(clearCart()).toBe(false);
    expect(loadPendingOrderPaymentSetup("order-1")).toEqual(validSetup);
    expect(loadOrderCreateAttempt()).toEqual({
      status: "found",
      attempt: { idempotencyKey: "create-key", phase: "submitting" },
    });
  });

  it("keeps the same payment marker when pending setup cleanup fails", () => {
    savePendingOrderPaymentSetup(validSetup);
    saveOrderPaymentAttempt({
      orderId: "order-1",
      idempotencyKey: "payment-key",
      phase: "submitting",
    });
    expect(saveOrderCompletionReceipt(validReceipt)).toBe(true);
    vi.spyOn(window.sessionStorage, "removeItem").mockImplementation(() => undefined);

    expect(clearPendingOrderPaymentSetup("order-1")).toBe(false);
    expect(loadOrderPaymentAttempt("order-1")).toEqual({
      status: "found",
      attempt: {
        orderId: "order-1",
        idempotencyKey: "payment-key",
        phase: "submitting",
      },
    });
  });
});
