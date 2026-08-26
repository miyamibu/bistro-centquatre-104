import { NextResponse } from "next/server";
import { getStaffAuth } from "@/lib/staff-auth";
import {
  getOrderNotificationOutboxBacklog,
} from "@/lib/order-notification-outbox";
import { getReservationEmailOutboxBacklog } from "@/lib/reservation-email-outbox";
import { listSchedulerHeartbeats } from "@/lib/scheduler-heartbeat";

export const dynamic = "force-dynamic";

const HEARTBEAT_WARNING_MS = 15 * 60 * 1000;

export async function GET() {
  const staff = await getStaffAuth("ADMIN");
  if (!staff) {
    return NextResponse.json(
      { error: "Unauthorized", code: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const [heartbeats, reservation, order] = await Promise.all([
    listSchedulerHeartbeats(),
    getReservationEmailOutboxBacklog(),
    getOrderNotificationOutboxBacklog(),
  ]);
  const now = Date.now();
  const lanes = ["RESERVATION_EMAIL", "ORDER_NOTIFICATION"] as const;
  const staleLanes = lanes.filter((lane) => {
    const heartbeat = heartbeats.find(
      (entry) => entry.schedulerKind === "GITHUB_ACTIONS" && entry.lane === lane,
    );
    return !heartbeat?.lastSuccessAt || now - heartbeat.lastSuccessAt.getTime() > HEARTBEAT_WARNING_MS;
  });

  return NextResponse.json(
    {
      ok: true,
      warning: staleLanes.length > 0,
      staleLanes,
      backlog: {
        reservation: {
          count: reservation.backlog,
          oldestAt: reservation.oldestBacklogAt?.toISOString() ?? null,
        },
        order: {
          count: order.backlog,
          oldestAt: order.oldestBacklogAt?.toISOString() ?? null,
        },
      },
      heartbeats: heartbeats.map((entry) => ({
        schedulerKind: entry.schedulerKind,
        lane: entry.lane,
        lastStartedAt: entry.lastStartedAt.toISOString(),
        lastSuccessAt: entry.lastSuccessAt?.toISOString() ?? null,
        lastFailureAt: entry.lastFailureAt?.toISOString() ?? null,
        processedCount: entry.processedCount,
        retryCount: entry.retryCount,
        deadLetterCount: entry.deadLetterCount,
        backlogCount: entry.backlogCount,
        oldestBacklogAt: entry.oldestBacklogAt?.toISOString() ?? null,
        lastRunId: entry.lastRunId,
        lastProviderCronAt: entry.lastProviderCronAt?.toISOString() ?? null,
        immediateAttempts: entry.immediateAttempts,
        immediateSuccesses: entry.immediateSuccesses,
        lastErrorCode: entry.lastErrorCode,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
