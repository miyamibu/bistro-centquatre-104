import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiError, readLimitedJson } from "@/lib/api-security";
import { sendContactEmail } from "@/lib/email";
import { logError, logInfo, getRequestId } from "@/lib/logger";
import { createContactSchema, zodFields } from "@/lib/validation";
import {
  CONTACT_RATE_LIMIT_WINDOW_SECONDS,
  enforceContactRateLimit,
  isContactRateLimitExceededError,
} from "@/lib/contact-rate-limit";
import { getClientIp } from "@/lib/request-meta";

export const dynamic = "force-dynamic";

const SUBMIT_ERROR_MESSAGE = "送信に失敗しました。時間をおいて再度お試しください。";

function hashLogValue(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 12);
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const json = await readLimitedJson(request, { requestId });
  if (!json.ok) return json.response;

  const parsed = createContactSchema.safeParse(json.body);

  if (!parsed.success) {
    return apiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      fields: zodFields(parsed.error),
      requestId,
    });
  }

  try {
    await enforceContactRateLimit({
      ipAddress: getClientIp(request),
      email: parsed.data.email,
    });
  } catch (error) {
    if (isContactRateLimitExceededError(error)) {
      return apiError(
        429,
        {
          error: error.message,
          code: error.code,
          requestId,
        },
        {
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": String(CONTACT_RATE_LIMIT_WINDOW_SECONDS),
          },
        },
      );
    }

    logError("contact.rate_limit.failed", {
      requestId,
      route: "/api/contact",
      errorCode: "CONTACT_RATE_LIMIT_UNAVAILABLE",
      context: {
        emailHash: hashLogValue(parsed.data.email),
      },
    });
    return apiError(
      503,
      {
        error: "お問い合わせ受付を一時停止しています。時間をおいて再試行してください。",
        code: "CONTACT_RATE_LIMIT_UNAVAILABLE",
        requestId,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const emailResult = await sendContactEmail(parsed.data);
  const safeContext = {
    emailHash: hashLogValue(parsed.data.email),
    subjectLength: parsed.data.subject.trim().length,
  };

  if (!emailResult.accepted || !emailResult.sent) {
    logError("contact.send.failed", {
      requestId,
      route: "/api/contact",
      errorCode: emailResult.reason,
      context: safeContext,
    });

    return apiError(502, {
      error: SUBMIT_ERROR_MESSAGE,
      code: "CONTACT_DELIVERY_FAILED",
      requestId,
    });
  }

  logInfo("contact.received", {
    requestId,
    route: "/api/contact",
    context: {
      ...safeContext,
      delivered: true,
    },
  });

  return NextResponse.json({
    ok: true,
    requestId,
  });
}
