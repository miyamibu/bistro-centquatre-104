import { prisma } from "@/lib/prisma";
import { createMonitorHandler, MONITOR_KEY, type MonitorState, type MonitorStore } from "./independent-outbox-monitor";

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
export const handleIndependentOutboxMonitor = createMonitorHandler({ store,
  secrets: () => ({ ingest: process.env.OUTBOX_MONITOR_TOKEN, evaluate: process.env.CRON_SECRET }) });
