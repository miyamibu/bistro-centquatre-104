import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Fixture = { headers: string; body: unknown; status: string; exit: number; stderr?: string };
const okBody = { ok: true, scanned: 0, sent: 0, failed: 0, deadLetter: 0, backlog: 0 };
const sensitive = "synthetic-private@example.test receipt-private-token secret-private-token";
function headers(...statuses: number[]) {
  return statuses.map((status, index) =>
    `HTTP/2 ${status}\r\nDate: Sun, 04 Oct 2026 18:12:${22 + index} GMT\r\nX-Receipt: ${sensitive}\r\n\r\n`,
  ).join("");
}
function fixture(statuses = [200], body: unknown = okBody, exit = 0): Fixture {
  return { headers: headers(...statuses), body, status: String(statuses.at(-1) ?? "000"), exit };
}

function runWorkflow(reservation: Fixture, order: Fixture) {
  const dir = mkdtempSync(join(tmpdir(), "outbox-workflow-synthetic-"));
  try {
    const workflow = readFileSync(resolve(".github/workflows/production-notification-outbox-drain.yml"), "utf8");
    const script = workflow.split("        run: |\n")[1].split("\n")
      .map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
    const fixturesPath = join(dir, "fixtures.json");
    const callsPath = join(dir, "calls.jsonl");
    const summaryPath = join(dir, "summary.md");
    writeFileSync(fixturesPath, JSON.stringify([reservation, order]));
    writeFileSync(join(dir, "curl"), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const previous = fs.existsSync(process.env.MOCK_CALLS) ? fs.readFileSync(process.env.MOCK_CALLS, 'utf8').trim().split('\\n').length : 0;
const fixture = JSON.parse(fs.readFileSync(process.env.MOCK_FIXTURES, 'utf8'))[previous];
if (!fixture) process.exit(99);
fs.appendFileSync(process.env.MOCK_CALLS, JSON.stringify(args) + '\\n');
fs.writeFileSync(args[args.indexOf('--dump-header') + 1], fixture.headers);
fs.writeFileSync(args[args.indexOf('--output') + 1], typeof fixture.body === 'string' ? fixture.body : JSON.stringify(fixture.body));
process.stderr.write(fixture.stderr || '');
process.stdout.write(fixture.status);
process.exit(fixture.exit);
`, { mode: 0o700 });
    const result = spawnSync("bash", ["-c", script], {
      cwd: process.cwd(), encoding: "utf8", timeout: 10_000,
      env: {
        ...process.env, PATH: `${dir}:${process.env.PATH}`, TMPDIR: dir,
        PRODUCTION_BASE_URL: "https://synthetic.invalid", CRON_SECRET: "synthetic-secret",
        GITHUB_RUN_ID: "synthetic-run", GITHUB_STEP_SUMMARY: summaryPath,
        MOCK_FIXTURES: fixturesPath, MOCK_CALLS: callsPath,
      },
    });
    const calls = readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]);
    return {
      status: result.status, stdout: result.stdout, stderr: result.stderr,
      summary: readFileSync(summaryPath, "utf8"), calls,
      rawFilesCleaned: calls.every((args) => ["--output", "--dump-header"].every((flag) => !existsSync(args[args.indexOf(flag) + 1]))),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("notification outbox workflow HTTP observations (mock curl, no network)", () => {
  it("retains 500 then 200 with zero final sweep counts and marks delivery recovery unverified", () => {
    const result = runWorkflow(fixture([500, 200], { ...okBody, providerMessageId: sensitive }), fixture());
    expect(result.status).toBe(0);
    expect(result.summary).toContain("lane=RESERVATION_EMAIL; attempt=1; HTTP=500; errorCode=HTTP_500");
    expect(result.summary).toContain("lane=RESERVATION_EMAIL; attempt=2; HTTP=200; errorCode=NONE");
    expect(result.summary).toContain("HTTP_recovered=YES; delivery_recovery=UNVERIFIED");
    expect(result.summary).toContain("responseAt=2026-10-04T18:12:22+00:00");
    expect(result.summary).toContain("reservation: final sweep PASS (delivery recovery unverified); http=200 code=UNKNOWN scanned=0 sent=0");
    expect(result.calls).toHaveLength(2);
    for (const args of result.calls) {
      expect(args[args.indexOf("--retry") + 1]).toBe("1");
      expect(args).toContain("--retry-all-errors");
      expect(args).toContain("--fail-with-body");
    }
    expect(result.stdout + result.stderr + result.summary).not.toContain(sensitive);
    expect(result.rawFilesCleaned).toBe(true);
  });

  it("preserves a persistent failure and only exposes an allowlisted final API error code", () => {
    const result = runWorkflow(
      fixture([500, 500], { code: "CRON_RESERVATION_EMAIL_OUTBOX_PARTIAL_FAILURE", email: sensitive }, 22),
      fixture([500], { code: "CRON_ORDER_NOTIFICATION_OUTBOX_FAILED", error: sensitive }, 22),
    );
    expect(result.status).toBe(1);
    expect(result.summary).toContain("attempt=1; HTTP=500; errorCode=HTTP_500");
    expect(result.summary).toContain("attempt=2; HTTP=500; errorCode=CRON_RESERVATION_EMAIL_OUTBOX_PARTIAL_FAILURE");
    expect(result.summary).toContain("order: FAIL");
    expect(result.summary).not.toContain("HTTP_recovered=YES");
    expect(result.stdout + result.stderr + result.summary).not.toContain(sensitive);
  });

  it("does not reuse another lane's headers or leak curl stderr on a transport failure", () => {
    const result = runWorkflow(fixture(), { headers: "", body: "", status: "000", exit: 7, stderr: sensitive });
    expect(result.status).toBe(1);
    expect(result.summary).toContain("lane=ORDER_NOTIFICATION; attempt=unobserved; HTTP=UNKNOWN; errorCode=CURL_7");
    expect(result.summary).not.toContain("lane=ORDER_NOTIFICATION; attempt=1;");
    expect(result.stdout + result.stderr + result.summary).not.toContain(sensitive);
    expect(result.rawFilesCleaned).toBe(true);
  });

  it("rejects malformed final JSON without printing response body or jq diagnostics", () => {
    const result = runWorkflow(fixture([200], sensitive), fixture());
    expect(result.status).toBe(1);
    expect(result.summary).toContain("reservation: FAIL");
    expect(result.stdout + result.stderr + result.summary).not.toContain(sensitive);
  });

  it("does not let an untrusted error code inject summary text", () => {
    const result = runWorkflow(fixture([500], { code: `INJECTED\n${sensitive}` }, 22), fixture());
    expect(result.status).toBe(1);
    expect(result.summary).toContain("errorCode=UNRECOGNIZED_ERROR_CODE");
    expect(result.stdout + result.stderr + result.summary).not.toMatch(/INJECTED|private-token|private@example/);
  });

  it("does not invent response timestamps or count informational HTTP responses as attempts", () => {
    const result = runWorkflow({
      ...fixture(),
      headers: `HTTP/1.1 100 Continue\r\n\r\nHTTP/2 200\r\nDate: invalid ${sensitive}\r\nX-Note: HTTP/2 500\r\n\r\n`,
    }, fixture());
    expect(result.status).toBe(0);
    expect(result.summary).toContain("lane=RESERVATION_EMAIL; attempt=1; HTTP=200; errorCode=NONE; responseAt=unknown;");
    expect(result.summary).not.toContain("lane=RESERVATION_EMAIL; attempt=2;");
    expect(result.summary).toContain("transport-only attempts may be unobserved");
    expect(result.summary).toContain("recordedAt is capture completion");
  });

  it("retains bounded counters from a partial 500, including a send and an absent backlog", () => {
    const result = runWorkflow(fixture([500], {
      code: "CRON_RESERVATION_EMAIL_OUTBOX_PARTIAL_FAILURE",
      scanned: 2, sent: 1, failed: 1, deadLetter: 0, error: sensitive,
    }, 22), fixture());
    expect(result.status).toBe(1);
    expect(result.summary).toContain("reservation: FAIL; http=500 code=CRON_RESERVATION_EMAIL_OUTBOX_PARTIAL_FAILURE scanned=2 sent=1 failed=1 deadLetter=0 backlog=UNKNOWN");
    expect(result.stdout + result.stderr + result.summary).not.toContain(sensitive);
  });

  it.each([
    ["array", [{ code: "CRON_RESERVATION_EMAIL_OUTBOX_FAILED" }]],
    ["null", null],
    ["oversized", { code: "CRON_RESERVATION_EMAIL_OUTBOX_FAILED", padding: "x".repeat(17000) }],
  ])("uses UNKNOWN for a %s response without dumping its data", (_name, body) => {
    const result = runWorkflow(fixture([500], body, 22), fixture());
    expect(result.status).toBe(1);
    expect(result.summary).toContain("reservation: FAIL; http=500 code=UNKNOWN scanned=UNKNOWN sent=UNKNOWN failed=UNKNOWN deadLetter=UNKNOWN backlog=UNKNOWN");
    expect(result.summary).not.toContain("padding");
  });

  it("rejects unsafe counters and HTTP status text in the final summary", () => {
    const result = runWorkflow({ ...fixture([500], {
      code: `INJECTED\n${sensitive}`, scanned: -1, sent: 1.5,
      failed: 1e100, deadLetter: "3", backlog: 1000001,
    }, 22), status: "500\nFORGED" }, fixture());
    expect(result.status).toBe(1);
    expect(result.summary).toContain("reservation: FAIL; http=UNKNOWN code=UNKNOWN scanned=UNKNOWN sent=UNKNOWN failed=UNKNOWN deadLetter=UNKNOWN backlog=UNKNOWN");
    expect(result.stdout + result.stderr + result.summary).not.toMatch(/INJECTED|FORGED|private-token|private@example/);
  });

  it("does not attribute a reservation error code to the order lane", () => {
    const result = runWorkflow(fixture(), fixture([500], {
      code: "CRON_RESERVATION_EMAIL_OUTBOX_FAILED", scanned: 0,
    }, 22));
    expect(result.status).toBe(1);
    expect(result.summary).toContain("lane=ORDER_NOTIFICATION; attempt=1; HTTP=500; errorCode=UNRECOGNIZED_ERROR_CODE");
    expect(result.summary).toContain("order: FAIL; http=500 code=UNKNOWN scanned=0");
    expect(result.summary).not.toContain("CRON_RESERVATION_EMAIL_OUTBOX_FAILED");
  });
});
