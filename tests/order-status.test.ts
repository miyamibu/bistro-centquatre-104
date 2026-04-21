import { describe, expect, it } from "vitest";
import { canTransitionActiveOrderStatus } from "@/lib/order-status";

describe("Order status transitions", () => {
  it("allows QUOTED -> PENDING_PAYMENT", () => {
    expect(canTransitionActiveOrderStatus("QUOTED", "PENDING_PAYMENT")).toBe(true);
  });

  it("allows PENDING_PAYMENT -> PAID", () => {
    expect(canTransitionActiveOrderStatus("PENDING_PAYMENT", "PAID")).toBe(true);
  });

  it("rejects QUOTED -> SHIPPED", () => {
    expect(canTransitionActiveOrderStatus("QUOTED", "SHIPPED")).toBe(false);
  });

  it("rejects SHIPPED -> PAID", () => {
    expect(canTransitionActiveOrderStatus("SHIPPED", "PAID")).toBe(false);
  });
});

