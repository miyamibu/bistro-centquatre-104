import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("order notification retry schedule", () => {
  it("uses the public GitHub standard runner every five minutes", () => {
    const vercelConfig = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { crons?: Array<{ path: string; schedule: string }> };
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/production-notification-outbox-drain.yml"),
      "utf8",
    );

    expect(vercelConfig.crons).toBeUndefined();
    expect(workflow).toContain('cron: "2-57/5 * * * *"');
    expect(workflow).toContain('/api/crons/process-order-notifications?limit=10&deadlineMs=8000');
    expect(workflow).toContain("runs-on: ubuntu-latest");
  });
});
