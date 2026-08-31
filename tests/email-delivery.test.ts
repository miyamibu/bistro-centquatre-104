import { afterEach, describe, expect, it, vi } from "vitest";
import { ReservationStatus, ReservationType } from "@prisma/client";

const baseEnv = {
  NODE_ENV: "test",
  STORE_NAME: "Bistro 104",
};

function mockEnv(overrides: Record<string, string | undefined>) {
  vi.doMock("@/lib/env", () => ({
    env: {
      ...baseEnv,
      ...overrides,
    },
  }));
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("Email delivery hardening", () => {
  it("fails closed for contact when provider config is missing", async () => {
    mockEnv({
      EMAIL_PROVIDER: undefined,
      EMAIL_API_KEY: undefined,
      RESEND_API_KEY: undefined,
      STORE_NOTIFY_EMAIL: "staff@example.com",
      EMAIL_FROM: "no-reply@example.com",
      ADMIN_EMAIL: "ops@example.com",
    });

    const { sendContactEmail } = await import("@/lib/email");
    const result = await sendContactEmail({
      name: "Taro",
      email: "taro@example.com",
      subject: "予約について",
      message: "テスト",
    });

    expect(result).toMatchObject({
      sent: false,
      accepted: false,
      reason: "MISSING_ENV",
    });
  });

  it("delivers contact mail through Resend branch", async () => {
    const resendSend = vi.fn().mockResolvedValue({ data: { id: "mail_1" }, error: null });
    vi.doMock("resend", () => ({
      Resend: vi.fn().mockImplementation(function ResendMock() {
        return {
          emails: {
            send: resendSend,
          },
        };
      }),
    }));

    mockEnv({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_key",
      EMAIL_API_KEY: undefined,
      EMAIL_FROM: "no-reply@example.com",
      ADMIN_EMAIL: "ops@example.com",
      STORE_NOTIFY_EMAIL: "staff@example.com",
    });

    const { sendContactEmail } = await import("@/lib/email");
    const result = await sendContactEmail({
      name: "Taro",
      email: "taro@example.com",
      subject: "予約について",
      message: "テスト",
    });

    expect(result).toMatchObject({ sent: true, accepted: true, provider: "resend" });
    expect(resendSend).toHaveBeenCalledTimes(1);
  });

  it("passes a stable reservation idempotency key and returns the provider message ID", async () => {
    const resendSend = vi.fn().mockResolvedValue({
      data: { id: "mail_reservation_1" },
      error: null,
    });
    vi.doMock("resend", () => ({
      Resend: vi.fn().mockImplementation(function ResendMock() {
        return { emails: { send: resendSend } };
      }),
    }));

    mockEnv({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "no-reply@example.com",
      STORE_NOTIFY_EMAIL: "staff@example.com",
    });

    const { sendReservationEmail } = await import("@/lib/email");
    const result = await sendReservationEmail({
      reservation: {
        id: "reservation-1",
        date: "2026-08-15",
        servicePeriod: "DINNER",
        reservationType: "NORMAL",
        seatType: "MAIN",
        partySize: 2,
        arrivalTime: "18:00",
        name: "Taro",
        phone: "09000000000",
        note: null,
        status: "CONFIRMED",
      } as never,
      idempotencyKey: "reservation-email-outbox/outbox-1",
    });

    expect(result).toMatchObject({
      sent: true,
      provider: "resend",
      providerMessageId: "mail_reservation_1",
    });
    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: "staff@example.com" }),
      { idempotencyKey: "reservation-email-outbox/outbox-1" }
    );
  });

  it("rejects a cancelled reservation before provider configuration is consulted", async () => {
    mockEnv({
      EMAIL_PROVIDER: undefined,
      RESEND_API_KEY: undefined,
      EMAIL_API_KEY: undefined,
      STORE_NOTIFY_EMAIL: "staff@example.com",
    });

    const { sendReservationEmail } = await import("@/lib/email");
    const result = await sendReservationEmail({
      reservation: {
        reservationType: "NORMAL",
        status: "CANCELLED",
      } as never,
    });

    expect(result).toEqual({
      skipped: true,
      reason: "RESERVATION_NOT_CONFIRMED",
    });
  });

  it("delivers contact mail through SendGrid branch", async () => {
    const sgSetApiKey = vi.fn();
    const sgSend = vi.fn().mockResolvedValue([{ statusCode: 202 }]);
    vi.doMock("@sendgrid/mail", () => ({
      default: {
        setApiKey: sgSetApiKey,
        send: sgSend,
      },
    }));

    mockEnv({
      EMAIL_PROVIDER: "sendgrid",
      EMAIL_API_KEY: "sg_test_key",
      EMAIL_FROM: "no-reply@example.com",
      ADMIN_EMAIL: "ops@example.com",
      STORE_NOTIFY_EMAIL: "staff@example.com",
      RESEND_API_KEY: undefined,
    });

    const { sendContactEmail } = await import("@/lib/email");
    const result = await sendContactEmail({
      name: "Taro",
      email: "taro@example.com",
      subject: "予約について",
      message: "テスト",
    });

    expect(result).toMatchObject({ sent: true, accepted: true, provider: "sendgrid" });
    expect(sgSetApiKey).toHaveBeenCalledWith("sg_test_key");
    expect(sgSend).toHaveBeenCalledTimes(1);
  });

  it("treats order confirmation as failure when delivery fails", async () => {
    const resendSend = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "provider failed" },
    });
    vi.doMock("resend", () => ({
      Resend: vi.fn().mockImplementation(function ResendMock() {
        return {
          emails: {
            send: resendSend,
          },
        };
      }),
    }));

    mockEnv({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "no-reply@example.com",
      ADMIN_EMAIL: undefined,
      STORE_NOTIFY_EMAIL: "staff@example.com",
    });

    const { sendOrderConfirmationEmail } = await import("@/lib/email");
    const result = await sendOrderConfirmationEmail(
      {
        name: "Taro",
        email: "taro@example.com",
        phone: "09000000000",
        zipCode: "100-0001",
        prefecture: "東京都",
        city: "千代田区",
        address: "1-1-1",
      },
      [{ id: "item-1", name: "Soup", price: 1000, quantity: 1 }],
      1000,
      "BANK_TRANSFER",
      undefined,
      {
        bank_name: "Mizuho",
        branch_name: "Tokyo",
        account_type: "普通",
        account_number: "1234567",
        account_holder: "Bistro",
      }
    );

    expect(result).toMatchObject({
      sent: false,
      reason: "SEND_FAILED",
      target: "customer",
    });
  });

  it("escapes every dynamic HTML value while retaining readable text fallback", async () => {
    const resendSend = vi.fn().mockResolvedValue({ data: { id: "mail_2" }, error: null });
    vi.doMock("resend", () => ({
      Resend: vi.fn().mockImplementation(function ResendMock() {
        return {
          emails: {
            send: resendSend,
          },
        };
      }),
    }));

    mockEnv({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "no-reply@example.com",
      ADMIN_EMAIL: "ops@example.com",
      STORE_NOTIFY_EMAIL: "staff@example.com",
    });

    const maliciousValue = '<img src=x onerror="alert(1)"> & "quoted" \'single\'';
    const { sendOrderConfirmationEmail } = await import("@/lib/email");
    const result = await sendOrderConfirmationEmail(
      {
        name: maliciousValue,
        email: "customer@example.com",
        phone: "09000000000",
        zipCode: "100-0001",
        prefecture: "東京都",
        city: "千代田区",
        address: maliciousValue,
      },
      [{ id: "item-1", name: maliciousValue, price: 1000, quantity: 1 }],
      1000,
      "BANK_TRANSFER",
      undefined,
      {
        bank_name: maliciousValue,
        branch_name: "Tokyo",
        account_type: "普通",
        account_number: "1234567",
        account_holder: "Bistro",
      }
    );

    expect(result).toMatchObject({ sent: true, adminSent: true, provider: "resend" });
    expect(resendSend).toHaveBeenCalledTimes(2);
    for (const [message] of resendSend.mock.calls) {
      const payload = message as { html?: unknown; text?: unknown };
      expect(typeof payload.html).toBe("string");
      expect(typeof payload.text).toBe("string");
      expect(payload.html).not.toContain(maliciousValue);
      expect(payload.html).toContain(
        "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;quoted&quot;"
      );
      expect(payload.html).toContain("&#39;single&#39;");
      expect(payload.text).toContain(maliciousValue);
    }
  });

  it("does not send a reservation confirmation after cancellation", async () => {
    mockEnv({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "no-reply@example.com",
      STORE_NOTIFY_EMAIL: "staff@example.com",
    });

    const { sendReservationEmail } = await import("@/lib/email");
    const result = await sendReservationEmail({
      reservation: {
        id: "reservation-1",
        date: "2026-08-15",
        servicePeriod: "DINNER",
        reservationType: ReservationType.NORMAL,
        seatType: "MAIN",
        partySize: 2,
        arrivalTime: "18:00",
        name: "山田 花子",
        phone: "090-0000-0000",
        customerEmail: null,
        customerEmailVerifiedAt: null,
        contactChannel: null,
        note: null,
        status: ReservationStatus.CANCELLED,
        cancellationPolicyVersion: null,
        cancellationPolicyAcceptedAt: null,
        cancelledAt: null,
        cancelSource: null,
        cancellationReason: null,
        lineUserId: null,
        lineReminderSentAt: null,
        lineReminderStatus: null,
        lineReminderError: null,
        lineClaimTokenHash: null,
        lineClaimExpiresAt: null,
        lineConfirmationSentAt: null,
        lineLinkedAt: null,
        lineLinkSource: null,
        linePushStatus: null,
        linePushCheckedAt: null,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });

    expect(result).toEqual({ skipped: true, reason: "RESERVATION_NOT_CONFIRMED" });
  });
});
