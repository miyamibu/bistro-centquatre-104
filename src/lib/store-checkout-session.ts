"use client";

import { restoreCartItems, type StoreCartItem } from "@/lib/store-cart";

export type PendingOrderPaymentSetup = {
  orderId: string;
  expectedVersion: number;
  humanToken: string;
  paymentMethod: "BANK_TRANSFER" | "PAY_IN_STORE" | null;
  storeVisitDate: string | null;
  holdExpiresAt: string;
  cartItems?: StoreCartItem[];
};

export type OrderCompletionReceipt = {
  orderId: string;
  paymentMethod: "BANK_TRANSFER" | "PAY_IN_STORE";
  storeVisitDate: string | null;
  notificationStatus: "SENT" | "PENDING_RETRY";
};

const STORAGE_KEY = "bistro.pending-order-payment";
const COMPLETION_STORAGE_KEY = "bistro.order-completion";

export function savePendingOrderPaymentSetup(value: PendingOrderPaymentSetup) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function loadPendingOrderPaymentSetup(orderId?: string | null): PendingOrderPaymentSetup | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PendingOrderPaymentSetup;
    if (orderId && parsed.orderId !== orderId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingOrderPaymentSetup() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}

export function restorePendingOrderCart(setup: PendingOrderPaymentSetup | null) {
  if (!setup?.cartItems?.length) return false;
  restoreCartItems(setup.cartItems);
  return true;
}

export function saveOrderCompletionReceipt(receipt: OrderCompletionReceipt) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(COMPLETION_STORAGE_KEY, JSON.stringify(receipt));
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
