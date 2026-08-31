import { describe, expect, it } from "vitest";
import {
  isValidReservationIdempotencyKey,
  RESERVATION_IDEMPOTENCY_KEY_MAX_LENGTH,
} from "@/lib/reservation-idempotency";

describe("reservation idempotency key contract", () => {
  it("accepts the shared 256-character API boundary and rejects larger keys", () => {
    expect(RESERVATION_IDEMPOTENCY_KEY_MAX_LENGTH).toBe(256);
    expect(isValidReservationIdempotencyKey("x".repeat(256))).toBe(true);
    expect(isValidReservationIdempotencyKey("x".repeat(257))).toBe(false);
  });
});
