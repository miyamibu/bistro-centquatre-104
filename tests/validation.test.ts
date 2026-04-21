import { describe, expect, it } from "vitest";
import {
  createContactSchema,
  createOrderSchema,
  createPrivateBlockSchema,
  createReservationSchema,
} from "@/lib/validation";

describe("Validation schemas", () => {
  it("accepts valid reservation payload", () => {
    const parsed = createReservationSchema.safeParse({
      date: "2026-03-15",
      servicePeriod: "DINNER",
      partySize: 2,
      arrivalTime: "18:30",
      name: "山田 太郎",
      phone: "090-1111-2222",
      course: "ディナー",
      note: "窓側希望",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid reservation party size", () => {
    const parsed = createReservationSchema.safeParse({
      date: "2026-03-15",
      servicePeriod: "DINNER",
      partySize: 0,
      arrivalTime: "18:00",
      name: "山田 太郎",
      phone: "090-1111-2222",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects reservation payload without arrival time", () => {
    const parsed = createReservationSchema.safeParse({
      date: "2026-03-15",
      servicePeriod: "DINNER",
      partySize: 2,
      name: "山田 太郎",
      phone: "090-1111-2222",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects reservation payload without service period", () => {
    const parsed = createReservationSchema.safeParse({
      date: "2026-03-15",
      partySize: 2,
      arrivalTime: "18:00",
      name: "山田 太郎",
      phone: "090-1111-2222",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts private block payload with required access code", () => {
    const parsed = createPrivateBlockSchema.safeParse({
      reservationType: "PRIVATE_BLOCK",
      privateBlockAccessCode: "secret-code",
      date: "2026-03-15",
      arrivalTime: "18:00",
      lastName: "貸切",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects private block payload without access code", () => {
    const parsed = createPrivateBlockSchema.safeParse({
      reservationType: "PRIVATE_BLOCK",
      date: "2026-03-15",
      arrivalTime: "18:00",
      lastName: "貸切",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects PAY_IN_STORE order without visit date", () => {
    const parsed = createOrderSchema.safeParse({
      items: [{ id: "item-1", quantity: 1 }],
      customerInfo: {
        name: "山田 太郎",
        email: "test@example.com",
        phone: "090-1111-2222",
        zipCode: "100-0001",
        prefecture: "東京都",
        city: "千代田区",
        address: "1-1-1",
      },
      paymentMethod: "PAY_IN_STORE",
      total: 1000,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts BANK_TRANSFER order payload", () => {
    const parsed = createOrderSchema.safeParse({
      items: [{ id: "item-1", quantity: 2 }],
      customerInfo: {
        name: "山田 太郎",
        email: "test@example.com",
        phone: "090-1111-2222",
        zipCode: "100-0001",
        prefecture: "東京都",
        city: "千代田区",
        address: "1-1-1",
      },
      paymentMethod: "BANK_TRANSFER",
      total: 2000,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts valid contact payload", () => {
    const parsed = createContactSchema.safeParse({
      name: "山田 太郎",
      email: "test@example.com",
      subject: "営業について",
      message: "ランチ営業の開始時間を確認したいです。",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid contact email", () => {
    const parsed = createContactSchema.safeParse({
      name: "山田 太郎",
      email: "not-an-email",
      subject: "営業について",
      message: "ランチ営業の開始時間を確認したいです。",
    });
    expect(parsed.success).toBe(false);
  });
});
