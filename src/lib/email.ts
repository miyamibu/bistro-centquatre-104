import { Reservation } from "@prisma/client";
import { parseReservationNote } from "@/lib/reservation-note";
import { env } from "@/lib/env";

type EmailProvider = "resend" | "sendgrid";
type EmailFailureReason = "MISSING_ENV" | "UNKNOWN_PROVIDER" | "SEND_FAILED";

interface EmailConfig {
  provider: EmailProvider;
  apiKey: string;
  from: string;
}

interface EmailSendRequest {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  from?: string;
}

type EmailDeliveryResult =
  | { sent: true; provider: EmailProvider }
  | { sent: false; reason: EmailFailureReason; provider?: EmailProvider };

interface ReservationEmailPayload {
  reservation: Reservation;
  adminUrl?: string;
}

interface ContactEmailPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
}

function resolveEmailConfig():
  | { ok: true; config: EmailConfig }
  | { ok: false; reason: EmailFailureReason; provider?: EmailProvider } {
  const provider = env.EMAIL_PROVIDER;
  if (!provider) {
    return { ok: false, reason: "MISSING_ENV" };
  }

  if (provider !== "resend" && provider !== "sendgrid") {
    return { ok: false, reason: "UNKNOWN_PROVIDER" };
  }

  const apiKey =
    provider === "resend"
      ? env.RESEND_API_KEY ?? env.EMAIL_API_KEY
      : env.EMAIL_API_KEY;

  if (!apiKey) {
    return { ok: false, reason: "MISSING_ENV", provider };
  }

  return {
    ok: true,
    config: {
      provider,
      apiKey,
      from: env.EMAIL_FROM ?? env.STORE_NOTIFY_EMAIL ?? "no-reply@example.com",
    },
  };
}

function formatFromAddress(storeName: string, fromAddress: string) {
  if (fromAddress.includes("<") && fromAddress.includes(">")) {
    return fromAddress;
  }
  return `${storeName} <${fromAddress}>`;
}

async function sendEmail(message: EmailSendRequest): Promise<EmailDeliveryResult> {
  const resolved = resolveEmailConfig();
  if (!resolved.ok) {
    return {
      sent: false,
      reason: resolved.reason,
      ...(resolved.provider ? { provider: resolved.provider } : {}),
    };
  }

  const { provider, apiKey, from } = resolved.config;

  try {
    if (provider === "resend") {
      const { Resend } = await import("resend");
      const resend = new Resend(apiKey);
      const resendBasePayload = {
        from: message.from ?? from,
        to: message.to,
        subject: message.subject,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      };

      let response:
        | { error?: { message?: string } | null }
        | undefined;

      if (typeof message.html === "string") {
        response = await resend.emails.send({
          ...resendBasePayload,
          html: message.html,
          ...(typeof message.text === "string" ? { text: message.text } : {}),
        });
      } else if (typeof message.text === "string") {
        response = await resend.emails.send({
          ...resendBasePayload,
          text: message.text,
        });
      } else {
        throw new Error("Email body is missing");
      }

      if ((response as { error?: { message?: string } | null }).error) {
        throw new Error(
          (response as { error?: { message?: string } | null }).error?.message ??
            "Resend delivery failed"
        );
      }

      return { sent: true, provider };
    }

    const sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(apiKey);
    const sendgridBasePayload = {
      from: message.from ?? from,
      to: message.to,
      subject: message.subject,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    };

    if (typeof message.html === "string") {
      await sgMail.send({
        ...sendgridBasePayload,
        html: message.html,
        ...(typeof message.text === "string" ? { text: message.text } : {}),
      });
    } else if (typeof message.text === "string") {
      await sgMail.send({
        ...sendgridBasePayload,
        text: message.text,
      });
    } else {
      throw new Error("Email body is missing");
    }

    return { sent: true, provider };
  } catch (error) {
    console.error("Email send failed", {
      provider,
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "SEND_FAILED", provider };
  }
}

export async function sendReservationEmail({ reservation, adminUrl }: ReservationEmailPayload) {
  const to = env.STORE_NOTIFY_EMAIL;

  if (reservation.reservationType === "PRIVATE_BLOCK") {
    return { skipped: true, reason: "PRIVATE_BLOCK" as const };
  }

  if (!to) {
    return { skipped: true, reason: "MISSING_ENV" as const };
  }

  const { course, note } = parseReservationNote(reservation.note);
  const subject = `【新規予約】${reservation.date} ${reservation.partySize}名`;
  const body = [
    `日付: ${reservation.date}`,
    `時間帯: ${reservation.servicePeriod === "LUNCH" ? "ランチ" : "ディナー"}`,
    `コース: ${course ?? "未選択"}`,
    `人数: ${reservation.partySize}`,
    `来店目安: ${reservation.arrivalTime ?? "未入力"}`,
    `氏名: ${reservation.name}`,
    `電話: ${reservation.phone}`,
    `要望: ${note ?? "なし"}`,
    adminUrl ? `管理画面: ${adminUrl}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  const delivery = await sendEmail({
    to,
    subject,
    text: body,
  });

  if (!delivery.sent) {
    return { skipped: true, reason: delivery.reason };
  }

  return { sent: true as const, provider: delivery.provider };
}

export async function sendContactEmail({ name, email, subject, message }: ContactEmailPayload) {
  const to = env.ADMIN_EMAIL ?? env.STORE_NOTIFY_EMAIL;

  if (!to) {
    return {
      sent: false as const,
      accepted: false as const,
      reason: "MISSING_ENV" as const,
    };
  }

  const text = [
    "お問い合わせを受け付けました。",
    "",
    `名前: ${name}`,
    `メールアドレス: ${email}`,
    `件名: ${subject}`,
    "",
    "お問い合わせ内容:",
    message,
  ].join("\n");

  const delivery = await sendEmail({
    to,
    subject: `【お問い合わせ】${subject}`,
    text,
    replyTo: email,
  });

  if (!delivery.sent) {
    return {
      sent: false as const,
      accepted: false as const,
      reason: delivery.reason,
    };
  }

  return {
    sent: true as const,
    accepted: true as const,
    provider: delivery.provider,
  };
}

interface OrderItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  zipCode: string;
  prefecture: string;
  city: string;
  address: string;
  building?: string;
}

interface BankAccount {
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  account_holder: string;
}

type OrderEmailResult =
  | { sent: true; provider: EmailProvider; adminSent: boolean }
  | {
      sent: false;
      reason: EmailFailureReason;
      target: "customer" | "admin";
      provider?: EmailProvider;
    };

export async function sendOrderConfirmationEmail(
  customerInfo: CustomerInfo,
  items: OrderItem[],
  total: number,
  paymentMethod: "bank-transfer" | "cash-store" | "BANK_TRANSFER" | "PAY_IN_STORE",
  storeVisitDate?: string,
  bankAccount?: BankAccount
): Promise<OrderEmailResult> {
  const storeName = env.STORE_NAME || "Bistro 104";
  const fromAddress = formatFromAddress(
    storeName,
    env.EMAIL_FROM ?? env.STORE_NOTIFY_EMAIL ?? "no-reply@example.com"
  );

  const itemsHtml = items
    .map(
      (item) =>
        `<tr>
          <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.name}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">×${item.quantity}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">¥${item.price.toLocaleString("ja-JP")}</td>
          <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">¥${(item.price * item.quantity).toLocaleString("ja-JP")}</td>
        </tr>`
    )
    .join("");

  const paymentInfo =
    paymentMethod === "bank-transfer" || paymentMethod === "BANK_TRANSFER"
      ? `
      <h3 style="color: #2f1b0f; margin-top: 20px;">お振込先</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px; background-color: #f7ebd3; font-weight: bold;">銀行:</td>
          <td style="padding: 8px;">${bankAccount?.bank_name || "未設定"}</td>
        </tr>
        <tr>
          <td style="padding: 8px; background-color: #f7ebd3; font-weight: bold;">支店:</td>
          <td style="padding: 8px;">${bankAccount?.branch_name || "未設定"}</td>
        </tr>
        <tr>
          <td style="padding: 8px; background-color: #f7ebd3; font-weight: bold;">口座種別:</td>
          <td style="padding: 8px;">${bankAccount?.account_type || "未設定"}</td>
        </tr>
        <tr>
          <td style="padding: 8px; background-color: #f7ebd3; font-weight: bold;">口座番号:</td>
          <td style="padding: 8px;">${bankAccount?.account_number || "未設定"}</td>
        </tr>
        <tr>
          <td style="padding: 8px; background-color: #f7ebd3; font-weight: bold;">口座名義:</td>
          <td style="padding: 8px;">${bankAccount?.account_holder || "未設定"}</td>
        </tr>
      </table>
      <p style="color: #666; margin-top: 10px; font-size: 12px;">
        ご入金確認後、商品を発送いたします。
      </p>
    `
      : `
      <h3 style="color: #2f1b0f; margin-top: 20px;">来店予定日</h3>
      <p style="font-size: 16px; font-weight: bold; color: #2f1b0f;">${storeVisitDate}</p>
      <p style="color: #666; margin-top: 10px;">
        ご来店時に現金でお支払いください。上記日付でのご来店をお待ちしております。
      </p>
    `;

  const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: 'Arial', sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #2f1b0f; color: white; padding: 20px; text-align: center; border-radius: 5px; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { margin-top: 20px; }
            .customer-info { background-color: #f7ebd3; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; }
            th { background-color: #2f1b0f; color: white; padding: 10px; text-align: left; }
            .total-row { background-color: #2f1b0f; color: white; font-weight: bold; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>ご注文ありがとうございます</h1>
            </div>

            <div class="content">
              <h2 style="color: #2f1b0f;">顧客情報</h2>
              <div class="customer-info">
                <p><strong>お名前:</strong> ${customerInfo.name}</p>
                <p><strong>メール:</strong> ${customerInfo.email}</p>
                <p><strong>電話:</strong> ${customerInfo.phone}</p>
                <p><strong>住所:</strong> ${customerInfo.zipCode} ${customerInfo.prefecture}${customerInfo.city}${customerInfo.address}${customerInfo.building ? customerInfo.building : ""}</p>
              </div>

              <h3 style="color: #2f1b0f; margin-top: 20px;">ご注文内容</h3>
              <table>
                <thead>
                  <tr>
                    <th>商品名</th>
                    <th style="text-align: center;">数量</th>
                    <th style="text-align: right;">単価</th>
                    <th style="text-align: right;">小計</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                  <tr class="total-row">
                    <td colspan="3" style="padding: 10px; text-align: right;">合計:</td>
                    <td style="padding: 10px; text-align: right;">¥${total.toLocaleString("ja-JP")}</td>
                  </tr>
                </tbody>
              </table>

              ${paymentInfo}

              <div class="footer">
                <p>${storeName}</p>
                <p>このメールにご返信いただいてもお返事できませんのでご了承ください。</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

  const customerDelivery = await sendEmail({
    from: fromAddress,
    to: customerInfo.email,
    subject: `ご注文確認 - ${storeName}`,
    html,
  });

  if (!customerDelivery.sent) {
    return {
      sent: false,
      reason: customerDelivery.reason,
      provider: customerDelivery.provider,
      target: "customer",
    };
  }

  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) {
    return { sent: true, provider: customerDelivery.provider, adminSent: false };
  }

  const staffHtml = `
        <h2>新しい注文が入りました</h2>
        <h3>顧客情報</h3>
        <p><strong>名前:</strong> ${customerInfo.name}</p>
        <p><strong>メール:</strong> ${customerInfo.email}</p>
        <p><strong>電話:</strong> ${customerInfo.phone}</p>
        <p><strong>住所:</strong> ${customerInfo.zipCode} ${customerInfo.prefecture}${customerInfo.city}${customerInfo.address}${customerInfo.building ? customerInfo.building : ""}</p>
        <h3>注文内容</h3>
        <table border="1" cellpadding="10" cellspacing="0">
          <thead>
            <tr>
              <th>商品名</th>
              <th>数量</th>
              <th>単価</th>
              <th>小計</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
            <tr style="font-weight: bold;">
              <td colspan="3" style="text-align: right;">合計:</td>
              <td style="text-align: right;">¥${total.toLocaleString("ja-JP")}</td>
            </tr>
          </tbody>
        </table>
        <h3>支払い方法</h3>
        <p>${paymentMethod === "bank-transfer" || paymentMethod === "BANK_TRANSFER" ? "銀行振込" : "来店時支払い"}</p>
        ${paymentMethod === "cash-store" || paymentMethod === "PAY_IN_STORE" ? `<p><strong>来店予定日:</strong> ${storeVisitDate}</p>` : ""}
      `;

  const adminDelivery = await sendEmail({
    from: fromAddress,
    to: adminEmail,
    subject: `新規注文: ${customerInfo.name}様`,
    html: staffHtml,
  });

  if (!adminDelivery.sent) {
    return {
      sent: false,
      reason: adminDelivery.reason,
      provider: adminDelivery.provider,
      target: "admin",
    };
  }

  return { sent: true, provider: customerDelivery.provider, adminSent: true };
}
