import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const vercelConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")
) as { crons: Array<{ path: string; schedule: string }> };

describe("order notification retry schedule", () => {
  it("runs often enough to recover a durable pending outbox row", () => {
    expect(vercelConfig.crons).toContainEqual({
      path: "/api/crons/process-order-notifications",
      schedule: "*/5 * * * *",
    });
  });
});
