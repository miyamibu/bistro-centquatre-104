import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["prisma", "generate"], { stdio: "inherit" });
process.exit(result.status ?? 1);
