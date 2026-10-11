import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn());
const heartbeat = vi.hoisted(() => ({
  markSchedulerStarted: vi.fn(),
  markSchedulerSucceeded: vi.fn(),
  markSchedulerFailed: vi.fn(),
  readSchedulerContext: vi.fn(() => ({ schedulerKind: "GITHUB_ACTIONS", runId: "test-run" })),
}));

vi.mock("@/lib/supabase-server", () => ({ supabaseServer: { from: fromMock } }));
vi.mock("@/lib/email", () => ({ sendOrderConfirmationEmail: sendMock }));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "synthetic-cron-secret" } }));
vi.mock("@/lib/scheduler-heartbeat", () => heartbeat);
vi.mock("@/lib/logger", () => ({
  getRequestId: vi.fn(() => "test-request"),
  logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(),
}));
vi.mock("node:crypto", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:crypto")>(),
  randomUUID: vi.fn(() => "test-claim"),
}));

type Outcome = "lookup" | "claim" | "skip" | "missing" | "sent";

function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "or", "order", "limit", "update", "maybeSingle"]) {
    chain[name] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

// Only external persistence and email are mocked. Both aggregation and the
// route exercise the real per-order processor and fenced state transitions.
function arrange(outcomes: Outcome[], includeBacklog = false) {
  const rows = outcomes.map((_, index) => ({
    id: `outbox-${index}`, order_id: `order-${index}`,
    notification_type: "ORDER_CONFIRMATION", attempts: 0, max_attempts: 5,
    claim_token: null, customer_sent_at: null, admin_sent_at: null, admin_skipped_at: null,
  }));
  const responses: unknown[] = [{ data: rows, error: null }];
  outcomes.forEach((outcome, index) => {
    const row = rows[index];
    if (outcome === "lookup") {
      responses.push({ data: null, error: { message: "synthetic lookup failure" } });
      return;
    }
    responses.push({ data: outcome === "missing" ? [] : [row], error: null });
    if (outcome === "missing") return;
    if (outcome === "claim") {
      responses.push({ data: null, error: { message: "synthetic claim failure" } });
      return;
    }
    if (outcome === "skip") {
      responses.push({ data: null, error: null });
      return;
    }
    responses.push(
      { data: { id: row.id, claim_token: "test-claim" }, error: null },
      { data: {
        id: row.order_id, customer_name: "Test", email: "test@example.invalid",
        phone: "", zip_code: "", prefecture: "", city: "", address: "",
        building: null, items: [], total: 0, payment_method: "PAY_IN_STORE",
        store_visit_date: null,
      }, error: null },
      { data: { id: row.id }, error: null },
      { data: { id: row.id }, error: null },
      { data: { id: row.id }, error: null },
    );
  });
  if (includeBacklog) responses.push({ data: [], count: 0, error: null });
  for (const response of responses) fromMock.mockReturnValueOnce(query(response));
  fromMock.mockImplementation(() => { throw new Error("Unexpected persistence call"); });
  return responses.length;
}

beforeEach(() => {
  vi.resetModules();
  fromMock.mockReset();
  sendMock.mockReset().mockResolvedValue({ sent: true, adminSent: true, provider: "test" });
  heartbeat.markSchedulerStarted.mockReset().mockResolvedValue(undefined);
  heartbeat.markSchedulerSucceeded.mockReset().mockResolvedValue(undefined);
  heartbeat.markSchedulerFailed.mockReset().mockResolvedValue(undefined);
});

describe("real order notification aggregation", () => {
  it.each([
    ["lookup", 0, 1, 0], ["claim", 0, 1, 0], ["skip", 0, 0, 1],
    ["missing", 0, 0, 1], ["sent", 1, 0, 0],
  ] as const)("accounts for %s without hiding failures or claim races", async (outcome, sent, failed, skipped) => {
    const calls = arrange([outcome]);
    const { processOrderNotificationOutbox } = await import("@/lib/order-notification-outbox");
    const summary = await processOrderNotificationOutbox({ requestId: "test-request" });
    expect(summary).toEqual({ scanned: 1, sent, failed, deadLetter: 0, skipped, deadlineReached: false });
    expect(fromMock).toHaveBeenCalledTimes(calls);
    expect(sendMock).toHaveBeenCalledTimes(outcome === "sent" ? 2 : 0);
  });

  it("preserves SENT and claim-skip counts alongside lookup and claim failures", async () => {
    const calls = arrange(["sent", "lookup", "claim", "skip"]);
    const { processOrderNotificationOutbox } = await import("@/lib/order-notification-outbox");
    expect(await processOrderNotificationOutbox({ requestId: "test-request" })).toEqual({
      scanned: 4, sent: 1, failed: 2, deadLetter: 0, skipped: 1, deadlineReached: false,
    });
    expect(fromMock).toHaveBeenCalledTimes(calls);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

describe("cron route with the real processor", () => {
  it.each([
    [["lookup"], 500, 0, 1, 0], [["claim"], 500, 0, 1, 0],
    [["skip"], 200, 0, 0, 1], [["sent"], 200, 1, 0, 0],
    [["sent", "lookup", "claim", "skip"], 500, 1, 2, 1],
    [["sent", "skip"], 200, 1, 0, 1],
  ] as const)("processes %j with HTTP %i", async (outcomes, status, sent, failed, skipped) => {
    const calls = arrange([...outcomes], true);
    const { GET } = await import("@/app/api/crons/process-order-notifications/route");
    const response = await GET(new NextRequest("http://localhost/api/crons/process-order-notifications", {
      headers: { authorization: "Bearer synthetic-cron-secret" },
    }));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toMatchObject({ scanned: outcomes.length, sent, failed, deadLetter: 0, skipped });
    if (status === 500) {
      expect(body.code).toBe("CRON_ORDER_NOTIFICATION_OUTBOX_PARTIAL_FAILURE");
      expect(heartbeat.markSchedulerFailed).toHaveBeenCalledWith(
        "ORDER_NOTIFICATION", expect.any(Object), "CRON_ORDER_NOTIFICATION_OUTBOX_PARTIAL_FAILURE",
      );
      expect(heartbeat.markSchedulerSucceeded).not.toHaveBeenCalled();
    } else {
      expect(body.ok).toBe(true);
      expect(heartbeat.markSchedulerSucceeded).toHaveBeenCalledOnce();
      expect(heartbeat.markSchedulerFailed).not.toHaveBeenCalled();
    }
    expect(fromMock).toHaveBeenCalledTimes(calls);
    expect(sendMock).toHaveBeenCalledTimes(sent * 2);
  });

  it("rejects unauthorized requests before persistence or email", async () => {
    const { GET } = await import("@/app/api/crons/process-order-notifications/route");
    const response = await GET(new NextRequest("http://localhost/api/crons/process-order-notifications"));
    expect(response.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
    expect(heartbeat.markSchedulerStarted).not.toHaveBeenCalled();
  });
});
