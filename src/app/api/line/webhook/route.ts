import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getLineChannelSecret, hasLineWebhookEnv } from "@/lib/env";
import { apiError } from "@/lib/api-security";
import { getRequestId, logInfo, logWarn } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function verifyLineSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  if (process.env.ALLOW_NONCANONICAL_GO_EXECUTION !== "1") {
    return apiError(503, {
      error: "non-canonical checkout is not an executable LINE endpoint",
      code: "NONCANONICAL_EXECUTION_BLOCKED",
      requestId,
    });
  }

  if (!hasLineWebhookEnv()) {
    logWarn("line.webhook.skipped.not_configured", {
      requestId,
      route: "/api/line/webhook",
    });
    return apiError(503, {
      error: "LINE webhook not configured",
      code: "LINE_WEBHOOK_NOT_CONFIGURED",
      requestId,
    });
  }

  const secret = getLineChannelSecret();
  if (!secret) {
    return apiError(503, {
      error: "LINE webhook not configured",
      code: "LINE_WEBHOOK_NOT_CONFIGURED",
      requestId,
    });
  }

  const signature = request.headers.get("x-line-signature");
  if (!signature) {
    return apiError(401, {
      error: "missing signature",
      code: "LINE_SIGNATURE_MISSING",
      requestId,
    });
  }

  const rawBody = await request.text();

  if (!verifyLineSignature(rawBody, signature, secret)) {
    // Do not log signature value or body — both are sensitive.
    logWarn("line.webhook.signature_invalid", {
      requestId,
      route: "/api/line/webhook",
    });
    return apiError(401, {
      error: "invalid signature",
      code: "LINE_SIGNATURE_INVALID",
      requestId,
    });
  }

  // Only after signature verification do we attempt to parse the body.
  let eventCount = 0;
  try {
    const payload = JSON.parse(rawBody) as { events?: unknown[] };
    eventCount = Array.isArray(payload.events) ? payload.events.length : 0;
  } catch {
    // Malformed but signed body — still respond OK; LINE retries otherwise.
  }

  logInfo("line.webhook.received", {
    requestId,
    route: "/api/line/webhook",
    context: { eventCount },
  });

  return NextResponse.json({ ok: true });
}
