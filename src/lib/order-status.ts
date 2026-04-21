export type ActiveOrderStatus = "QUOTED" | "PENDING_PAYMENT" | "PAID" | "SHIPPED";
export type OrderStatus = ActiveOrderStatus | "CANCELLED";

const TRANSITIONS: Record<ActiveOrderStatus, ActiveOrderStatus[]> = {
  QUOTED: ["PENDING_PAYMENT"],
  PENDING_PAYMENT: ["PAID"],
  PAID: ["SHIPPED"],
  SHIPPED: [],
};

export function canTransitionActiveOrderStatus(
  current: ActiveOrderStatus,
  next: ActiveOrderStatus
): boolean {
  return current === next || TRANSITIONS[current].includes(next);
}

