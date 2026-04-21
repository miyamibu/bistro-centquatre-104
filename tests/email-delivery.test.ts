import { afterEach, describe, expect, it, vi } from "vitest";

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
      Resend: vi.fn().mockImplementation(() => ({
        emails: {
          send: resendSend,
        },
      })),
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
      Resend: vi.fn().mockImplementation(() => ({
        emails: {
          send: resendSend,
        },
      })),
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
});
