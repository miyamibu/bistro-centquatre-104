import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiError, enforceWriteRequestSecurity } from "@/lib/api-security";
import { sendContactEmail } from "@/lib/email";
import { logError, logInfo, getRequestId } from "@/lib/logger";
import { createContactSchema, zodFields } from "@/lib/validation";

export const dynamic = "force-dynamic";

const SUBMIT_ERROR_MESSAGE = "送信に失敗しました。時間をおいて再度お試しください。";

function hashLogValue(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 12);
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const securityError = enforceWriteRequestSecurity(request);
  if (securityError) return securityError;

  const body = await request.json().catch(() => null);
  const parsed = createContactSchema.safeParse(body);

  if (!parsed.success) {
    return apiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      fields: zodFields(parsed.error),
      requestId,
    });
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
