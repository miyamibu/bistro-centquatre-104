import { describe, expect, it } from "vitest";
import {
  canRestorePendingOrderCart,
  classifyPaymentFailure,
  isPendingOrderSetupExpired,
  shouldShowStoreCartIcon,
  type PaymentConfirmationState,
} from "@/lib/store-payment-state";

describe("store payment navigation state", () => {
  const restoreCases: Array<[PaymentConfirmationState, boolean]> = [
    [{ requestedOrderId: "order-1", pendingOrderId: "order-1", phase: "stable" }, true],
    [{ requestedOrderId: "", pendingOrderId: "order-1", phase: "stable" }, false],
    [{ requestedOrderId: "order-1", pendingOrderId: null, phase: "stable" }, false],
    [{ requestedOrderId: "order-1", pendingOrderId: "order-2", phase: "stable" }, false],
    [{ requestedOrderId: "order-1", pendingOrderId: "order-1", phase: "submitting" }, false],
    [{ requestedOrderId: "order-1", pendingOrderId: "order-1", phase: "uncertain" }, false],
    [
      { requestedOrderId: "order-1", pendingOrderId: "order-1", phase: "success-navigation" },
      false,
    ],
  ];

  it.each(restoreCases)("allows cart restore only for an exact ID in a stable state", (state, expected) => {
    expect(canRestorePendingOrderCart(state)).toBe(expected);
  });

  it.each([
    ["2026-07-21T00:00:00.000Z", Date.parse("2026-07-20T23:59:59.999Z"), false],
    ["2026-07-21T00:00:00.000Z", Date.parse("2026-07-21T00:00:00.000Z"), true],
    ["not-a-date", Date.parse("2026-07-20T00:00:00.000Z"), true],
  ])("classifies hold expiry at the action boundary", (holdExpiresAt, now, expected) => {
    expect(isPendingOrderSetupExpired(holdExpiresAt, now)).toBe(expected);
  });

  it.each([
    [409, "", "uncertain"],
    [409, "VERSION_CONFLICT", "uncertain"],
    [401, "HUMAN_TOKEN_EXPIRED", "expired"],
    [404, "ORDER_NOT_FOUND", "expired"],
    [400, "INVALID_PAYMENT_METHOD", "retryable"],
    [500, "", "uncertain"],
  ])("classifies payment failures without treating general 409 as expiry", (status, code, expected) => {
    expect(classifyPaymentFailure(status, code)).toBe(expected);
  });

  it.each([
    ["/on-line-store", true],
    ["/on-line-store/apron", true],
    ["/on-line-store/pay", false],
    ["/on-line-store/pay/", false],
    ["/on-line-store/cart", false],
    ["/booking", false],
  ])("controls the cart icon for %s", (pathname, expected) => {
    expect(shouldShowStoreCartIcon(pathname)).toBe(expected);
  });
});
