import { handleIndependentOutboxMonitor } from "@/lib/independent-outbox-monitor-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleIndependentOutboxMonitor(request, "heartbeat");
}
