import { spawnSync } from "node:child_process";

const context = process.env.CONTEXT?.trim().toLowerCase() ?? "";
const releaseCheck =
  context === "production"
    ? "check:release:production"
    : context === "deploy-preview" || context === "branch-deploy"
      ? "check:release:preview"
      : "check:release";

function runNpmScript(script) {
  const result = spawnSync("npm", ["run", script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[netlify-build] ${script} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.info(`[netlify-build] context=${context || "local"}; release-check=${releaseCheck}`);
runNpmScript(releaseCheck);
runNpmScript("build");
