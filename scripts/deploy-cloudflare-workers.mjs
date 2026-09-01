import { spawnSync } from "node:child_process";

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

for (const config of configs) {
  const result = spawnSync("npx", ["wrangler", "deploy", "--minify", "--config", config], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
