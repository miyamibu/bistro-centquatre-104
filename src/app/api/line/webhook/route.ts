import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma, LineWebhookInboxStatus } from "@prisma/client";
import { getLineChannelSecret, hasLineWebhookEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { replyLineTextMessage } from "@/lib/line";
import { apiError } from "@/lib/api-security";
import { getRequestId, logInfo, logWarn } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_WEBHOOK_BODY_BYTES = 128 * 1024;
const MAX_EVENT_ID_LENGTH = 256;
const MAX_EVENT_TYPE_LENGTH = 64;
const INBOX_LOCK_MS = 5 * 60 * 1000;

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

type LineEventSource = { type?: unknown; userId?: unknown };
type LineEvent = {
  webhookEventId: string;
  type: string;
  source?: LineEventSource;
  replyToken?: unknown;
  [key: string]: unknown;
};

type MinimizedInboxPayload = {
  schemaVersion: 1;
  minimized: true;
  sourceType?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEvents(rawBody: string): LineEvent[] {
  const payload = JSON.parse(rawBody) as { events?: unknown };
  if (!Array.isArray(payload.events)) return [];

  return payload.events.map((event): LineEvent => {
    if (!isRecord(event)) throw new Error("LINE_WEBHOOK_EVENT_INVALID");

    const eventId = event.webhookEventId;
    const eventType = event.type;
    if (
      typeof eventId !== "string" ||
      eventId.length === 0 ||
      eventId.length > MAX_EVENT_ID_LENGTH ||
      typeof eventType !== "string" ||
      eventType.length === 0 ||
      eventType.length > MAX_EVENT_TYPE_LENGTH
    ) {
      throw new Error("LINE_WEBHOOK_EVENT_ID_REQUIRED");
    }

    return event as LineEvent;
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") ||
    (isRecord(error) && error.code === "P2002")
  );
}

function buildMinimizedInboxPayload(event: LineEvent): MinimizedInboxPayload {
  const sourceType = isRecord(event.source) && typeof event.source.type === "string"
    ? event.source.type.slice(0, 32)
    : undefined;

  return {
    schemaVersion: 1,
    minimized: true,
    ...(sourceType ? { sourceType } : {}),
  };
}

async function persistInboxEvent(event: LineEvent, requestId: string) {
  try {
    return await prisma.lineWebhookInbox.create({
      data: {
        eventId: event.webhookEventId,
        eventType: event.type,
        // Idempotency and processing only require the columns above. Do not retain
        // LINE user IDs, reply tokens, message text, locations, or the raw event.
        payload: buildMinimizedInboxPayload(event) as Prisma.InputJsonValue,
        requestId,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    const existing = await prisma.lineWebhookInbox.findUnique({
      where: { eventId: event.webhookEventId },
    });
    if (!existing) throw error;
    return existing;
  }
}

async function claimInboxEvent(id: string): Promise<string | null> {
  const claimToken = randomUUID();
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + INBOX_LOCK_MS);
  const claimed = await prisma.lineWebhookInbox.updateMany({
    where: {
      id,
      status: {
        in: [
          LineWebhookInboxStatus.PENDING,
          LineWebhookInboxStatus.FAILED,
          LineWebhookInboxStatus.PROCESSING,
        ],
      },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: {
      status: LineWebhookInboxStatus.PROCESSING,
      attempts: { increment: 1 },
      claimedAt: now,
      lockedUntil,
      claimToken,
      lastError: null,
    },
  });

  return claimed.count > 0 ? claimToken : null;
}

async function markInboxFailed(id: string, claimToken: string): Promise<void> {
  try {
    await prisma.lineWebhookInbox.updateMany({
      where: {
        id,
        status: LineWebhookInboxStatus.PROCESSING,
        claimToken,
      },
      data: {
        status: LineWebhookInboxStatus.FAILED,
        lockedUntil: null,
        claimToken: null,
        lastError: "PROCESSING_FAILED",
      },
    });
  } catch (error) {
    logWarn("line.webhook.inbox_failure_update_failed", {
      route: "/api/line/webhook",
      context: { message: error instanceof Error ? error.message : String(error) },
    });
  }
}

function buildFollowReplyText(): string {
  return [
    "bistro centquatre 104 公式アカウントへのご登録ありがとうございます。",
    "",
    "LINE通知の設定は、予約完了画面に表示される連携リンクから行ってください。",
  ].join("\n");
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

async function processInboxEvent(
  event: LineEvent,
  requestId: string
): Promise<"processed" | "duplicate"> {
  const inbox = await persistInboxEvent(event, requestId);
  if (inbox.status === LineWebhookInboxStatus.PROCESSED) return "duplicate";

  const claimToken = await claimInboxEvent(inbox.id);
  if (!claimToken) {
    const current = await prisma.lineWebhookInbox.findUnique({
      where: { eventId: event.webhookEventId },
      select: { status: true },
    });
    if (current?.status === LineWebhookInboxStatus.PROCESSED) return "duplicate";
    throw new Error("LINE_WEBHOOK_INBOX_BUSY");
  }

  try {
    const source = isRecord(event.source) ? event.source : null;
    const userId = typeof source?.userId === "string" ? source.userId : undefined;
    const replyToken = typeof event.replyToken === "string" ? event.replyToken : undefined;

    if (event.type === "follow" && userId) {
      await handleFollow(userId, replyToken);
    } else if (event.type === "unfollow" && userId) {
      await handleUnfollow(userId);
    }
    // Unsupported and structurally incomplete signed events are still durable
    // and marked processed; they have no application side effect to retry.

    const completed = await prisma.lineWebhookInbox.updateMany({
      where: {
        id: inbox.id,
        status: LineWebhookInboxStatus.PROCESSING,
        claimToken,
      },
      data: {
        status: LineWebhookInboxStatus.PROCESSED,
        processedAt: new Date(),
        lockedUntil: null,
        claimToken: null,
        lastError: null,
      },
    });
    if (completed.count === 0) throw new Error("LINE_WEBHOOK_INBOX_FINALIZE_FAILED");
    return "processed";
  } catch (error) {
    await markInboxFailed(inbox.id, claimToken);
    throw error;
  }
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
    events = parseEvents(rawBody);
  } catch (parseError) {
    logWarn("line.webhook.malformed_body", { requestId, route: "/api/line/webhook" });
    return apiError(400, {
      error: parseError instanceof Error && parseError.message === "LINE_WEBHOOK_EVENT_ID_REQUIRED"
        ? "webhookEventId is required"
        : "malformed JSON",
      code: parseError instanceof Error && parseError.message === "LINE_WEBHOOK_EVENT_ID_REQUIRED"
        ? "LINE_WEBHOOK_EVENT_ID_REQUIRED"
        : "LINE_WEBHOOK_MALFORMED_JSON",
      requestId,
    });
  }

  logInfo("line.webhook.received", {
    requestId,
    route: "/api/line/webhook",
    context: { eventCount: events.length },
  });

  // Persist and process events sequentially. Never log userId, body, or signature.
  let followCount = 0;
  let unfollowCount = 0;
  let unsupportedCount = 0;
  let duplicateCount = 0;
  let failedCount = 0;

  for (const event of events) {
    try {
      const result = await processInboxEvent(event, requestId);
      if (result === "duplicate") {
        duplicateCount += 1;
      } else if (event.type === "follow" && isRecord(event.source) && typeof event.source.userId === "string") {
        followCount += 1;
      } else if (event.type === "unfollow" && isRecord(event.source) && typeof event.source.userId === "string") {
        unfollowCount += 1;
      } else if (event.type === "accountLink") {
        unsupportedCount += 1;
      } else {
        unsupportedCount += 1;
      }
    } catch (handlerError) {
      failedCount += 1;
      logWarn("line.webhook.handler_error", {
        requestId,
        route: "/api/line/webhook",
        context: {
          eventType: event.type,
          message: handlerError instanceof Error ? handlerError.message : String(handlerError),
        },
      });
      // Continue so other events can be durably accepted; the final non-200
      // response asks LINE to retry failed events.
    }
  }

  logInfo("line.webhook.processed", {
    requestId,
    route: "/api/line/webhook",
    context: { followCount, unfollowCount, unsupportedCount, duplicateCount, failedCount },
  });

  if (failedCount > 0) {
    return apiError(503, {
      error: "webhook event processing failed; retryable",
      code: "LINE_WEBHOOK_RETRY",
      requestId,
    });
  }

  return NextResponse.json({ ok: true });
}
