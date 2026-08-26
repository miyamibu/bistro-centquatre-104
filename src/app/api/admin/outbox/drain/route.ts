import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readLimitedJson, apiError } from "@/lib/api-security";
import { getRequestId, logError } from "@/lib/logger";
import {
  getOrderNotificationOutboxBacklog,
  processOrderNotificationOutbox,
} from "@/lib/order-notification-outbox";
import {
  getReservationEmailOutboxBacklog,
  processReservationEmailOutbox,
} from "@/lib/reservation-email-outbox";
import { prisma } from "@/lib/prisma";
import { getStaffAuth } from "@/lib/staff-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const manualDrainSchema = z.object({
  lane: z.enum(["RESERVATION_EMAIL", "ORDER_NOTIFICATION"]),
  limit: z.number().int().min(1).max(20),
  dryRun: z.boolean(),
  confirm: z.boolean(),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const staff = await getStaffAuth("ADMIN");
  if (!staff) {
    return apiError(401, { error: "Unauthorized", code: "UNAUTHORIZED", requestId });
  }

  const json = await readLimitedJson(request, { requestId, maxBytes: 2 * 1024 });
  if (!json.ok) return json.response;
  const parsed = manualDrainSchema.safeParse(json.body);
  if (!parsed.success) {
    return apiError(400, {
      error: "入力内容が不正です",
      code: "VALIDATION_ERROR",
      requestId,
    });
  }
  if (!parsed.data.dryRun && !parsed.data.confirm) {
    return apiError(400, {
      error: "実行確認が必要です",
      code: "CONFIRMATION_REQUIRED",
      requestId,
    });
  }

  const { lane, limit, dryRun } = parsed.data;
  const before =
    lane === "RESERVATION_EMAIL"
      ? await getReservationEmailOutboxBacklog()
      : await getOrderNotificationOutboxBacklog();
  const audit = await prisma.outboxDrainAuditLog.create({
    data: {
      actorUserId: staff.userId,
      actorEmail: staff.email,
      actorRole: staff.role,
      requestId,
      lane,
      dryRun,
      requestedLimit: limit,
      scannedCount: 0,
      sentCount: 0,
      failedCount: 0,
      deadLetterCount: 0,
      backlogCount: before.backlog,
    },
    select: { id: true },
  });

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      lane,
      requestedLimit: limit,
      backlog: before.backlog,
      oldestBacklogAt: before.oldestBacklogAt?.toISOString() ?? null,
      scanned: 0,
      sent: 0,
      failed: 0,
      deadLetter: 0,
      requestId,
    });
  }

  try {
    const result =
      lane === "RESERVATION_EMAIL"
        ? await processReservationEmailOutbox({ requestId, batchSize: limit, deadlineMs: 8_000 })
        : await processOrderNotificationOutbox({ requestId, limit, deadlineMs: 8_000 });
    const after =
      lane === "RESERVATION_EMAIL"
        ? await getReservationEmailOutboxBacklog()
        : await getOrderNotificationOutboxBacklog();
    await prisma.outboxDrainAuditLog.update({
      where: { id: audit.id },
      data: {
        scannedCount: result.scanned,
        sentCount: result.sent,
        failedCount: result.failed,
        deadLetterCount: result.deadLetter,
        backlogCount: after.backlog,
      },
    });

    return NextResponse.json({
      ok: result.failed === 0 && result.deadLetter === 0,
      dryRun: false,
      lane,
      requestedLimit: limit,
      scanned: result.scanned,
      sent: result.sent,
      failed: result.failed,
      deadLetter: result.deadLetter,
      backlog: after.backlog,
      oldestBacklogAt: after.oldestBacklogAt?.toISOString() ?? null,
      requestId,
    });
  } catch {
    logError("admin.outbox.manual_drain.failed", {
      requestId,
      route: "/api/admin/outbox/drain",
      errorCode: "MANUAL_DRAIN_FAILED",
      context: { lane, auditId: audit.id },
    });
    return apiError(500, {
      error: "Outbox再処理に失敗しました",
      code: "MANUAL_DRAIN_FAILED",
      requestId,
    });
  }
}
