import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getLineChannelSecret, hasLineWebhookEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { replyLineTextMessage } from "@/lib/line";
import { apiError } from "@/lib/api-security";
import { getRequestId, logInfo, logWarn } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_WEBHOOK_BODY_BYTES = 128 * 1024;

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

type LineEventSource = { userId?: string };
type LineEvent = {
  type: string;
  source?: LineEventSource;
  replyToken?: string;
};

function buildFollowReplyText(): string {
  const liffLinkId =
    process.env.NEXT_PUBLIC_LIFF_LINK_ID ?? process.env.NEXT_PUBLIC_LIFF_ID;
  const linkUrl = liffLinkId
    ? `https://liff.line.me/${liffLinkId}?mode=customer`
    : null;
  const lines = [
    "bistro centquatre 104 公式アカウントへのご登録ありがとうございます。",
    "",
    "電話番号を登録すると、通常予約時にLINE連携ボタンを完了していなくても、前日にお知らせメッセージをお送りします。",
  ];
  if (linkUrl) {
    lines.push("", `LINE通知登録はこちら:\n${linkUrl}`);
  }
  return lines.join("\n");
}

async function handleFollow(userId: string, replyToken?: string): Promise<void> {
  const now = new Date();
  await prisma.lineFriend.upsert({
    where: { lineUserId: userId },
    create: {
      lineUserId: userId,
      friendshipStatus: "FRIEND",
      followedAt: now,
      lastEventAt: now,
      updatedAt: now,
    },
    update: {
      friendshipStatus: "FRIEND",
      lastEventAt: now,
      updatedAt: now,
      // followedAt intentionally not updated on re-follow to preserve first seen.
    },
  });

  if (replyToken) {
    await replyLineTextMessage({ replyToken, text: buildFollowReplyText() });
  }
}

async function handleUnfollow(userId: string): Promise<void> {
  const now = new Date();
  await prisma.lineFriend.upsert({
    where: { lineUserId: userId },
    create: {
      lineUserId: userId,
      friendshipStatus: "BLOCKED",
      unfollowedAt: now,
      lastEventAt: now,
      updatedAt: now,
    },
    update: {
      friendshipStatus: "BLOCKED",
      unfollowedAt: now,
      lastEventAt: now,
      updatedAt: now,
    },
  });
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

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

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_WEBHOOK_BODY_BYTES) {
    logWarn("line.webhook.body_too_large", {
      requestId,
      route: "/api/line/webhook",
      context: { contentLength: Number(contentLength) },
    });
    return apiError(413, {
      error: "payload too large",
      code: "LINE_WEBHOOK_BODY_TOO_LARGE",
      requestId,
    });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    logWarn("line.webhook.body_too_large", {
      requestId,
      route: "/api/line/webhook",
    });
    return apiError(413, {
      error: "payload too large",
      code: "LINE_WEBHOOK_BODY_TOO_LARGE",
      requestId,
    });
  }

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

  // Only after signature verification do we parse the body.
  let events: LineEvent[] = [];
  try {
    const payload = JSON.parse(rawBody) as { events?: unknown[] };
    events = Array.isArray(payload.events) ? (payload.events as LineEvent[]) : [];
  } catch {
    logWarn("line.webhook.malformed_body", { requestId, route: "/api/line/webhook" });
    return apiError(400, {
      error: "malformed JSON",
      code: "LINE_WEBHOOK_MALFORMED_JSON",
      requestId,
    });
  }

  logInfo("line.webhook.received", {
    requestId,
    route: "/api/line/webhook",
    context: { eventCount: events.length },
  });

  // Process events sequentially. Never log userId, body, or signature.
  let followCount = 0;
  let unfollowCount = 0;
  let unsupportedCount = 0;

  for (const event of events) {
    const userId = event.source?.userId;

    try {
      if (event.type === "follow" && userId) {
        await handleFollow(userId, event.replyToken);
        followCount += 1;
      } else if (event.type === "unfollow" && userId) {
        await handleUnfollow(userId);
        unfollowCount += 1;
      } else if (event.type === "accountLink") {
        // accountLink requires nonce verification against stored state.
        // Full implementation is deferred; log the count for observability.
        unsupportedCount += 1;
      }
      // Other event types (message, postback, etc.) are intentionally ignored.
    } catch (handlerError) {
      logWarn("line.webhook.handler_error", {
        requestId,
        route: "/api/line/webhook",
        context: {
          eventType: event.type,
          message: handlerError instanceof Error ? handlerError.message : String(handlerError),
        },
      });
      // Continue processing remaining events even if one fails.
    }
  }

  logInfo("line.webhook.processed", {
    requestId,
    route: "/api/line/webhook",
    context: { followCount, unfollowCount, unsupportedCount },
  });

  return NextResponse.json({ ok: true });
}
