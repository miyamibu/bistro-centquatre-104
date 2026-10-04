import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");
const exporter = join(repoRoot, "scripts/export-canonical-user-story-evidence.mjs");

function runWithSyntheticNpm(script: string) {
  const fixtureDir = mkdtempSync(join(tmpdir(), "bistro-qa-evidence-"));
  const outputPath = join(fixtureDir, "evidence.json");
  writeFileSync(join(fixtureDir, "npm"), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [exporter, `--output=${outputPath}`], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${fixtureDir}:${process.env.PATH}` },
  });
  const rawEvidence = readFileSync(outputPath, "utf8");
  return { result, rawEvidence, evidence: JSON.parse(rawEvidence) };
}

describe("canonical QA evidence exporter", () => {
  it("preserves a failed command and exit code without copying its output into the artifact or log", () => {
    const { result, rawEvidence, evidence } = runWithSyntheticNpm(`
if [ "$1" = "run" ] && [ "$2" = "lint" ]; then
  printf 'synthetic-private-marker\\n'
  exit 23
fi
exit 0`);

    expect(result.status).toBe(1);
    expect(evidence.summary.allValidationExitCodesZero).toBe(false);
    expect(evidence.summary.failedValidations).toEqual([
      { command: "npm run lint", exitCode: 23, signal: null, errorCode: null },
    ]);
    expect(result.stderr).toContain("validation_failed=npm run lint exit=23");
    expect(`${rawEvidence}${result.stdout}${result.stderr}`).not.toContain("synthetic-private-marker");
  });

  it("treats a signal with null exit status as a failure", () => {
    const { result, evidence } = runWithSyntheticNpm(`
if [ "$1" = "run" ] && [ "$2" = "typecheck" ]; then
  kill -TERM $$
fi
exit 0`);

    expect(result.status).toBe(1);
    expect(evidence.summary.failedValidations).toEqual([
      { command: "npm run typecheck", exitCode: null, signal: "SIGTERM", errorCode: null },
    ]);
  });
});
