import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { createNotificationDispatcher } from "./independent-outbox-monitor-notifications";
import { createMonitorHandler, validateState, MONITOR_KEY, type MonitorState, type MonitorStore } from "./independent-outbox-monitor";

const store: MonitorStore = {
  async transaction(operation) {
    let expectedJSON: string | null = null;
    const result = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ monitorState: unknown }[]>`
        SELECT "monitorState" FROM public."SchedulerHeartbeat"
        WHERE "schedulerKind" = ${MONITOR_KEY.schedulerKind} AND lane = ${MONITOR_KEY.lane}
        FOR UPDATE`;
      return operation(rows[0]?.monitorState, async (state: MonitorState) => {
        const updated = await tx.$executeRaw`
          UPDATE public."SchedulerHeartbeat" SET "monitorState" = ${JSON.stringify(state)}::jsonb, "updatedAt" = now()
          WHERE "schedulerKind" = ${MONITOR_KEY.schedulerKind} AND lane = ${MONITOR_KEY.lane}`;
        if (updated !== 1) throw new Error("MONITOR_ROW_MISSING");
        expectedJSON = JSON.stringify(state);
      });
    }, { maxWait: 3000, timeout: 5000 });
    // This installed Prisma runtime can resolve a callback result after a deferred
    // PostgreSQL COMMIT error. Verify autocommit-visible state before any 2xx.
    if (expectedJSON === null) throw new Error("MONITOR_SAVE_REQUIRED");
    const durable = await prisma.$queryRaw<{ durable: boolean }[]>`
      SELECT "monitorState" = ${expectedJSON}::jsonb AS durable
      FROM public."SchedulerHeartbeat"
      WHERE "schedulerKind" = ${MONITOR_KEY.schedulerKind} AND lane = ${MONITOR_KEY.lane}`;
    if (durable.length !== 1 || durable[0].durable !== true) throw new Error("MONITOR_COMMIT_UNVERIFIED");
    return result;
  },
};
// Same existing app provider-key and sender expressions; only owner destination is new.
// No environment values are copied into monitor JSON, errors or responses.
const notifications = createNotificationDispatcher({ store, validate: validateState,
  getConfig: () => ({ provider: env.EMAIL_PROVIDER, apiKey: env.RESEND_API_KEY ?? env.EMAIL_API_KEY,
    from: env.EMAIL_FROM ?? env.STORE_NOTIFY_EMAIL ?? "no-reply@example.com",
    ownerEmail: process.env.OUTBOX_MONITOR_OWNER_EMAIL }) });
// Dedicated evaluator credential only; no fallback to the shared cron credential.
export const handleIndependentOutboxMonitor = createMonitorHandler({ store, notifications,
  secrets: () => ({ ingest: process.env.OUTBOX_MONITOR_TOKEN, evaluate: process.env.OUTBOX_MONITOR_EVALUATE_TOKEN }) });
