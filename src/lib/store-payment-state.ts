export type PaymentConfirmationState = {
  requestedOrderId: string | null | undefined;
  pendingOrderId: string | null | undefined;
  phase: "stable" | "submitting" | "uncertain" | "success-navigation";
};

export function canRestorePendingOrderCart({
  requestedOrderId,
  pendingOrderId,
  phase,
}: PaymentConfirmationState) {
  return Boolean(
    requestedOrderId?.trim() &&
      pendingOrderId === requestedOrderId &&
      phase === "stable",
  );
}

export function isPendingOrderSetupExpired(holdExpiresAt: string, now: number): boolean {
  const expiresAt = Date.parse(holdExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export type PaymentFailureClassification = "expired" | "uncertain" | "retryable";

export function classifyPaymentFailure(
  status: number,
  code: string,
): PaymentFailureClassification {
  if (code === "HUMAN_TOKEN_EXPIRED" || code === "ORDER_NOT_FOUND") {
    return "expired";
  }
  if (status === 409 || status >= 500) {
    return "uncertain";
  }
  return "retryable";
}

export function shouldShowStoreCartIcon(pathname: string) {
  return (
    pathname === "/on-line-store" ||
    (pathname.startsWith("/on-line-store/") && pathname !== "/on-line-store/cart" && !isPayPath(pathname))
  );
}

function isPayPath(pathname: string) {
  return pathname === "/on-line-store/pay" || pathname.startsWith("/on-line-store/pay/");
}
