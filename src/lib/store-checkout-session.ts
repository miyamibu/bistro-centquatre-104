"use client";

import {
  readStoredCartItemsForRestore,
  restoreCartItems,
  type StoreCartItem,
} from "@/lib/store-cart";
import { formatJst, jstDateFromString } from "@/lib/dates";

export type PendingOrderPaymentSetup = {
  orderId: string;
  expectedVersion: number;
  humanToken: string;
  paymentMethod: "BANK_TRANSFER" | "PAY_IN_STORE";
  storeVisitDate: string | null;
  holdExpiresAt: string;
  cartItems: StoreCartItem[];
  quotedTotal: number;
};

export type OrderCompletionReceipt = {
  orderId: string;
  paymentMethod: "BANK_TRANSFER" | "PAY_IN_STORE";
  storeVisitDate: string | null;
  notificationStatus: "SENT" | "PENDING_RETRY";
};

export type PendingOrderCartRestoreResult =
  | "missing"
  | "restored"
  | "already-restored"
  | "conflict"
  | "storage-failed";

const STORAGE_KEY = "bistro.pending-order-payment";
const COMPLETION_STORAGE_KEY = "bistro.order-completion";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isStrictDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  try {
    const parsed = jstDateFromString(value);
    return Number.isFinite(parsed.getTime()) && formatJst(parsed) === value;
  } catch {
    return false;
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseServerConfirmedCartItems(value: unknown): StoreCartItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const items: StoreCartItem[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      !isPositiveSafeInteger(item.price) ||
      !isPositiveSafeInteger(item.quantity) ||
      item.quantity > 99 ||
      typeof item.image !== "string"
    ) {
      return null;
    }

    items.push({
      id: item.id,
      name: item.name,
      price: item.price,
      image: item.image,
      quantity: item.quantity,
    });
  }

  return items;
}

export function savePendingOrderPaymentSetup(value: PendingOrderPaymentSetup) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function loadPendingOrderPaymentSetup(orderId?: string | null): PendingOrderPaymentSetup | null {
  if (typeof window === "undefined") return null;
  if (typeof orderId !== "string" || !orderId.trim()) return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;

    const paymentMethod = parsed.paymentMethod;
    const storeVisitDate = parsed.storeVisitDate;
    const cartItems = parseServerConfirmedCartItems(parsed.cartItems);
    const quotedTotal = parsed.quotedTotal;

    if (
      typeof parsed.orderId !== "string" ||
      !parsed.orderId.trim() ||
      parsed.orderId !== orderId ||
      typeof parsed.expectedVersion !== "number" ||
      !Number.isSafeInteger(parsed.expectedVersion) ||
      parsed.expectedVersion < 0 ||
      typeof parsed.humanToken !== "string" ||
      !parsed.humanToken.trim() ||
      (paymentMethod !== "BANK_TRANSFER" && paymentMethod !== "PAY_IN_STORE") ||
      (storeVisitDate !== null &&
        (typeof storeVisitDate !== "string" || !isStrictDateString(storeVisitDate))) ||
      paymentMethod === "PAY_IN_STORE" && storeVisitDate === null ||
      typeof parsed.holdExpiresAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.holdExpiresAt)) ||
      !isPositiveSafeInteger(quotedTotal) ||
      !cartItems
    ) {
      return null;
    }

    const calculatedTotal = cartItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    if (calculatedTotal !== quotedTotal) return null;

    return {
      orderId: parsed.orderId,
      expectedVersion: parsed.expectedVersion,
      humanToken: parsed.humanToken,
      paymentMethod,
      storeVisitDate,
      holdExpiresAt: parsed.holdExpiresAt,
      cartItems,
      quotedTotal,
    };
  } catch {
    return null;
  }
}

export function clearPendingOrderPaymentSetup(expectedOrderId: string): boolean {
  if (typeof window === "undefined" || !expectedOrderId.trim()) return false;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.orderId !== expectedOrderId) return false;
    window.sessionStorage.removeItem(STORAGE_KEY);
    return window.sessionStorage.getItem(STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function restorePendingOrderCart(setup: PendingOrderPaymentSetup | null) {
  if (!setup?.cartItems.length) return false;
  return restoreCartItems(setup.cartItems);
}

function cartItemsMatch(left: StoreCartItem[], right: StoreCartItem[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        item.id === other.id &&
        item.name === other.name &&
        item.price === other.price &&
        item.image === other.image &&
        item.quantity === other.quantity
      );
    })
  );
}

export function restoreAndClearPendingOrderCart(
  orderId: string | null | undefined,
): PendingOrderCartRestoreResult {
  if (typeof window === "undefined" || typeof orderId !== "string" || !orderId.trim()) {
    return "missing";
  }

  try {
    if (!window.sessionStorage.getItem(STORAGE_KEY)) return "missing";
  } catch {
    return "storage-failed";
  }

  const setup = loadPendingOrderPaymentSetup(orderId);
  if (!setup || setup.orderId !== orderId) return "missing";

  const currentCart = readStoredCartItemsForRestore();
  if (!currentCart.ok) return "storage-failed";
  if (currentCart.items.length > 0 && !cartItemsMatch(currentCart.items, setup.cartItems)) {
    return "conflict";
  }

  if (currentCart.items.length === 0) {
    if (!restorePendingOrderCart(setup)) return "storage-failed";
    const restoredCart = readStoredCartItemsForRestore();
    if (!restoredCart.ok || !cartItemsMatch(restoredCart.items, setup.cartItems)) {
      return "storage-failed";
    }
    return clearPendingOrderPaymentSetup(orderId) ? "restored" : "storage-failed";
  }

  return clearPendingOrderPaymentSetup(orderId) ? "already-restored" : "storage-failed";
}

export function saveOrderCompletionReceipt(receipt: OrderCompletionReceipt): boolean {
  if (typeof window === "undefined") return false;
  try {
    const serialized = JSON.stringify(receipt);
    window.sessionStorage.setItem(COMPLETION_STORAGE_KEY, serialized);
    return window.sessionStorage.getItem(COMPLETION_STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
}

export function loadOrderCompletionReceipt(orderId: string | null): OrderCompletionReceipt | null {
  if (typeof window === "undefined" || !orderId) return null;

  const raw = window.sessionStorage.getItem(COMPLETION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<OrderCompletionReceipt>;
    const notificationStatus = parsed.notificationStatus === undefined ? "SENT" : parsed.notificationStatus;
    if (
      parsed.orderId !== orderId ||
      (parsed.paymentMethod !== "BANK_TRANSFER" && parsed.paymentMethod !== "PAY_IN_STORE") ||
      (parsed.storeVisitDate !== null && typeof parsed.storeVisitDate !== "string") ||
      (notificationStatus !== "SENT" && notificationStatus !== "PENDING_RETRY")
    ) {
      return null;
    }

    return { ...parsed, notificationStatus } as OrderCompletionReceipt;
  } catch {
    return null;
  }
}
