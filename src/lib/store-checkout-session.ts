"use client";

export type PendingOrderPaymentSetup = {
  orderId: string;
  expectedVersion: number;
  humanToken: string;
  paymentMethod: "BANK_TRANSFER" | "PAY_IN_STORE" | null;
  storeVisitDate: string | null;
  holdExpiresAt: string;
};

const STORAGE_KEY = "bistro.pending-order-payment";

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
