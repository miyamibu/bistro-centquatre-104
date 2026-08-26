const LANES = [
  "/api/crons/process-reservation-emails",
  "/api/crons/process-order-notifications",
];

function resolveBaseUrl() {
  const candidate = process.env.URL?.trim() || process.env.BASE_URL?.trim() || "";
  const url = new URL(candidate);
  if (url.protocol !== "https:") {
    throw new Error("PRODUCTION_BASE_URL_INVALID");
  }
  return url.origin;
}

async function invokeLane(baseUrl, path, runId) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new Error("CRON_SECRET_MISSING");

  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "X-Scheduler-Kind": "provider-failsafe",
      "X-Scheduler-Run-Id": runId,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.ok !== true) {
    throw new Error(`OUTBOX_FAILSAFE_${response.status}`);
  }
  return {
    lane: path.endsWith("reservation-emails") ? "RESERVATION_EMAIL" : "ORDER_NOTIFICATION",
    processed: Number(body.processed ?? 0),
    failed: Number(body.failed ?? 0),
    deadLetter: Number(body.deadLetter ?? 0),
    backlog: Number(body.backlog ?? 0),
  };
}

async function outboxFailsafe() {
  const baseUrl = resolveBaseUrl();
  const runId = `netlify-${Date.now()}`;
  const settled = await Promise.allSettled(
    LANES.map((path) => invokeLane(baseUrl, path, runId)),
  );
  const failures = settled.filter((result) => result.status === "rejected");
  const summaries = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );

  console.info("outbox.failsafe.completed", {
    succeededLanes: summaries.length,
    failedLanes: failures.length,
    summaries,
  });
  if (failures.length > 0) throw new Error("OUTBOX_FAILSAFE_PARTIAL_FAILURE");
}

export default outboxFailsafe;
