import { randomUUID } from "node:crypto";
import { Prisma, ReservationStatus, ReservationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { pushLineTextMessage, summarizeLineError } from "@/lib/line";
import { logError, logInfo, logWarn } from "@/lib/logger";

export type ReservationLineLifecycleType =
  | "RESERVATION_CHANGED"
  | "RESERVATION_CANCELLED";

const STALE_CLAIM_MS = 30 * 60 * 1000;

export async function enqueueReservationLineLifecycle(
  tx: Prisma.TransactionClient,
  input: {
    reservationId: string;
    lineUserId: string | null;
    type: ReservationLineLifecycleType;
    eventKey: string;
  },
) {
  if (!input.lineUserId) return null;
  return tx.notificationEvent.upsert({
    where: {
      reservationId_channel_type_targetDate: {
        reservationId: input.reservationId,
        channel: "LINE",
        type: input.type,
        targetDate: input.eventKey,
      },
    },
    create: {
      reservationId: input.reservationId,
      channel: "LINE",
      type: input.type,
      targetDate: input.eventKey,
      status: "PENDING",
      retryKey: randomUUID(),
    },
    update: {},
    select: { id: true },
  });
}

function buildLifecycleText(input: {
  type: ReservationLineLifecycleType;
  name: string;
  date: string;
  servicePeriod: "LUNCH" | "DINNER";
  partySize: number;
  arrivalTime: string | null;
}) {
  const heading = input.type === "RESERVATION_CHANGED"
    ? "店舗側でご予約内容を変更しました。"
    : "ご予約をキャンセルしました。";
  return [
    `${input.name} 様`,
    heading,
    `日付: ${input.date}`,
    `時間帯: ${input.servicePeriod === "LUNCH" ? "ランチ" : "ディナー"}`,
    `人数: ${input.partySize}`,
    `来店目安: ${input.arrivalTime ?? "未入力"}`,
    "内容に相違がある場合は店舗へお問い合わせください。",
  ].join("\n");
}

export async function processReservationLineLifecycleEvent(
  eventId: string,
  source: string,
) {
  const now = new Date();
  const staleAt = new Date(now.getTime() - STALE_CLAIM_MS);
  const claimToken = randomUUID();
  const claimed = await prisma.notificationEvent.updateMany({
    where: {
      id: eventId,
      channel: "LINE",
      type: { in: ["RESERVATION_CHANGED", "RESERVATION_CANCELLED"] },
      OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        { status: "SENDING", claimedAt: { lt: staleAt } },
        { status: "SENDING", claimedAt: null },
      ],
    },
    data: { status: "SENDING", claimedAt: now, claimToken, error: null },
  });
  if (claimed.count !== 1) return "skipped" as const;

  const event = await prisma.notificationEvent.findFirst({
    where: { id: eventId, status: "SENDING", claimToken },
    include: { reservation: true },
  });
  if (!event) return "failed" as const;

  async function finish(status: "SENT" | "FAILED" | "SKIPPED", error: string | null) {
    const result = await prisma.notificationEvent.updateMany({
      where: { id: eventId, status: "SENDING", claimToken },
      data: {
        status,
        error,
        sentAt: status === "SENT" ? new Date() : null,
        claimedAt: null,
        claimToken: null,
      },
    });
    return result.count === 1;
  }

  const type = event.type as ReservationLineLifecycleType;
  const reservation = event.reservation;
  const expectedStatus = type === "RESERVATION_CHANGED"
    ? ReservationStatus.CONFIRMED
    : ReservationStatus.CANCELLED;
  if (
    reservation.reservationType !== ReservationType.NORMAL ||
    reservation.status !== expectedStatus ||
    !reservation.lineUserId
  ) {
    await finish("SKIPPED", "RESERVATION_NOT_ELIGIBLE");
    return "skipped" as const;
  }

  const friend = await prisma.lineFriend.findUnique({
    where: { lineUserId: reservation.lineUserId },
    select: { friendshipStatus: true },
  }).catch(() => null);
  if (friend?.friendshipStatus === "BLOCKED") {
    await finish("SKIPPED", "LINE_USER_BLOCKED");
    return "skipped" as const;
  }

  const result = await pushLineTextMessage({
    to: reservation.lineUserId,
    text: buildLifecycleText({
      type,
      name: reservation.name,
      date: reservation.date,
      servicePeriod: reservation.servicePeriod,
      partySize: reservation.partySize,
      arrivalTime: reservation.arrivalTime,
    }),
    retryKey: event.retryKey,
  });
  if (!result.ok) {
    const error = summarizeLineError(result.error ?? "unknown");
    await finish("FAILED", error);
    logWarn("reservation.line_lifecycle.failed", {
      context: { reservationId: reservation.id, type, source, error },
    });
    return "failed" as const;
  }

  if (!(await finish("SENT", null))) {
    logError("reservation.line_lifecycle.sent_fence_lost", {
      errorCode: "LINE_LIFECYCLE_SENT_FENCE_LOST",
      context: { reservationId: reservation.id, type, source },
    });
    return "failed" as const;
  }
  logInfo("reservation.line_lifecycle.sent", {
    context: { reservationId: reservation.id, type, source },
  });
  return "sent" as const;
}

export async function processReservationLineLifecycleOutbox(input: {
  source: string;
  limit?: number;
}) {
  const candidates = await prisma.notificationEvent.findMany({
    where: {
      channel: "LINE",
      type: { in: ["RESERVATION_CHANGED", "RESERVATION_CANCELLED"] },
      status: { in: ["PENDING", "FAILED"] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(input.limit ?? 10, 25)),
    select: { id: true },
  });
  const outcomes = await Promise.all(
    candidates.map((event) => processReservationLineLifecycleEvent(event.id, input.source)),
  );
  return {
    scanned: candidates.length,
    sent: outcomes.filter((outcome) => outcome === "sent").length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
    skipped: outcomes.filter((outcome) => outcome === "skipped").length,
  };
}
