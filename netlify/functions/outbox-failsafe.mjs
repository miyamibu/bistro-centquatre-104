const ENDPOINTS = [
  { lane: "RESERVATION_EMAIL", path: "/api/crons/process-reservation-emails" },
  { lane: "ORDER_NOTIFICATION", path: "/api/crons/process-order-notifications" },
  { lane: "LINE_REMINDER", path: "/api/crons/remind?batchSize=100&deadlineMs=8000" },
];

function resolveBaseUrl() {
  const candidate = process.env.URL?.trim() || process.env.BASE_URL?.trim() || "";
  const url = new URL(candidate);
  if (url.protocol !== "https:") {
    throw new Error("PRODUCTION_BASE_URL_INVALID");
  }
  return url.origin;
}

async function invokeLane(baseUrl, endpoint, runId) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new Error("CRON_SECRET_MISSING");

  const response = await fetch(`${baseUrl}${endpoint.path}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "X-Scheduler-Kind": "provider-failsafe",
      "X-Scheduler-Run-Id": runId,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.ok !== true) {
    throw new Error(`PROVIDER_FAILSAFE_${endpoint.lane}_${response.status}`);
  }
  return {
    lane: endpoint.lane,
    processed: Number(body.processed ?? body.sent ?? 0),
    failed: Number(body.failed ?? 0),
    deadLetter: Number(body.deadLetter ?? 0),
    backlog: Number(body.backlog ?? 0),
  };
}

async function outboxFailsafe() {
  const baseUrl = resolveBaseUrl();
  const runId = `netlify-${Date.now()}`;
  const settled = await Promise.allSettled(
    ENDPOINTS.map((endpoint) => invokeLane(baseUrl, endpoint, runId)),
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
