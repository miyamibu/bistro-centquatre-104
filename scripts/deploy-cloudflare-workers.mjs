import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const configs = [
  "wrangler.operations-api.jsonc",
  "wrangler.outbox-api.jsonc",
  "wrangler.backup-api.jsonc",
  "wrangler.admin-reservations-api.jsonc",
  "wrangler.admin-reservation-detail-api.jsonc",
  "wrangler.admin-reservation-correction-api.jsonc",
  "wrangler.cron-api.jsonc",
  "wrangler.notification-cron-api.jsonc",
  "wrangler.order-notification-cron-api.jsonc",
  "wrangler.orders-api.jsonc",
  "wrangler.order-actions-api.jsonc",
  "wrangler.order-receipt-api.jsonc",
  "wrangler.dashboard-api.jsonc",
  "wrangler.line-api.jsonc",
  "wrangler.media-api.jsonc",
  "wrangler.public-api.jsonc",
  "wrangler.contact-api.jsonc",
  "wrangler.agent-api.jsonc",
  "wrangler.availability-api.jsonc",
  "wrangler.reservations-api.jsonc",
  "wrangler.admin-application.jsonc",
  "wrangler.customer-application.jsonc",
  "wrangler.default.jsonc",
];

const expectedHeadArg = process.argv.find((arg) => arg.startsWith("--expected-head="));
const expectedHead = expectedHeadArg?.slice("--expected-head=".length) ?? process.env.BISTRO_RELEASE_SHA;
const dryRun = process.argv.includes("--dry-run");

if (!/^[0-9a-f]{40}$/.test(expectedHead ?? "")) {
  throw new Error("A full release SHA is required via --expected-head=<sha> or BISTRO_RELEASE_SHA.");
}

const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== expectedHead) {
  throw new Error(`Release SHA mismatch: expected ${expectedHead}, current HEAD ${head}.`);
}

const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
  encoding: "utf8",
}).trim();
if (dirty) throw new Error("Tracked working tree changes must be committed before deployment.");

const timestamp = new Date().toISOString().replaceAll(":", "-");
const ledgerDir = resolve(process.env.BISTRO_RELEASE_LEDGER_DIR ?? "artifacts/cloudflare-releases");
mkdirSync(ledgerDir, { recursive: true, mode: 0o700 });
const ledgerPath = resolve(ledgerDir, `${timestamp}-${expectedHead}.json`);
const ledger = {
  schemaVersion: 1,
  releaseSha: expectedHead,
  startedAt: new Date().toISOString(),
  dryRun,
  status: "STARTED",
  workers: [],
};

function persistLedger() {
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
}

function wranglerJson(args) {
  const output = execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });
  return JSON.parse(output);
}

function currentVersion(config) {
  const deployments = wranglerJson(["deployments", "list", "--config", config, "--json"]);
  const latest = [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  const active = latest?.versions?.find((version) => Number(version.percentage) === 100);
  if (!active?.version_id) throw new Error(`Unable to resolve active version for ${config}.`);
  return active.version_id;
}

persistLedger();

if (dryRun) {
  for (const config of configs) {
    const args = ["wrangler", "deploy", "--dry-run", "--minify", "--config", config];
    if (config === "wrangler.default.jsonc") args.push("--var", `RELEASE_SHA:${expectedHead}`);
    const result = spawnSync("npx", args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  ledger.status = "DRY_RUN_PASS";
  ledger.finishedAt = new Date().toISOString();
  persistLedger();
  console.log(`Cloudflare dry-run ledger: ${ledgerPath}`);
  process.exit(0);
}

for (const config of configs) {
  ledger.workers.push({ config, previousVersionId: currentVersion(config), status: "PENDING" });
  persistLedger();
}

const deployed = [];
try {
  for (const worker of ledger.workers) {
    const args = [
      "wrangler",
      "deploy",
      "--minify",
      "--config",
      worker.config,
      "--message",
      `git:${expectedHead}`,
    ];
    if (worker.config === "wrangler.default.jsonc") args.push("--var", `RELEASE_SHA:${expectedHead}`);
    const result = spawnSync("npx", args, { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Deploy failed for ${worker.config}.`);
    worker.newVersionId = currentVersion(worker.config);
    worker.status = "DEPLOYED";
    deployed.push(worker);
    persistLedger();
  }
  ledger.status = "DEPLOYED";
  ledger.finishedAt = new Date().toISOString();
  persistLedger();
  console.log(`Cloudflare release ledger: ${ledgerPath}`);
} catch (error) {
  ledger.status = "ROLLBACK_STARTED";
  ledger.failure = error instanceof Error ? error.message : String(error);
  persistLedger();
  let rollbackFailed = false;
  for (const worker of deployed.reverse()) {
    const result = spawnSync(
      "npx",
      [
        "wrangler",
        "rollback",
        worker.previousVersionId,
        "--config",
        worker.config,
        "--message",
        `automatic rollback after failed git:${expectedHead}`,
        "--yes",
      ],
      { stdio: "inherit" },
    );
    worker.status = result.status === 0 ? "ROLLED_BACK" : "ROLLBACK_FAILED";
    rollbackFailed ||= result.status !== 0;
    persistLedger();
  }
  ledger.status = rollbackFailed ? "ROLLBACK_INCOMPLETE" : "ROLLED_BACK";
  ledger.finishedAt = new Date().toISOString();
  persistLedger();
  throw error;
}
