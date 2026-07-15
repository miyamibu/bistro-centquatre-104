import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const trackerPath = resolve(repoRoot, "docs/qa/canonical-user-story-status.csv");
const outputPath = resolve(repoRoot, "docs/qa/canonical-user-story-validation-evidence.json");

function run(command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
    ...options,
  });

  return {
    command: [command, ...args].join(" "),
    exitCode: result.status,
    signal: result.signal,
    startedAt,
    finishedAt: new Date().toISOString(),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error) : null,
  };
}

function hashFile(path) {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function commandText(entry) {
  if (entry.error) return entry.error;
  return `${entry.stdout}${entry.stderr}`;
}

const gitHead = run("git", ["rev-parse", "HEAD"]);
const gitBranch = run("git", ["branch", "--show-current"]);
const gitStatus = run("git", ["status", "--short"]);
const nodeVersion = run("node", ["--version"]);
const npmVersion = run("npm", ["--version"]);

const validations = [
  run("npm", ["run", "lint"]),
  run("npm", ["run", "typecheck"]),
  run("npm", ["run", "test"]),
  run("npm", ["run", "security:destructive"]),
  run("npm", ["run", "build"]),
];
const releaseChecks = {
  production: run("npm", ["run", "check:release:production"]),
};

const buildIdPath = resolve(repoRoot, ".next/BUILD_ID");
const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  purpose:
    "Canonical user-story tracker validation evidence for local release-readiness review.",
  scope:
    "Local dirty-snapshot evidence only. This file is not production deployment or external provider proof.",
  repository: {
    root: repoRoot,
    branch: gitBranch.stdout.trim() || null,
    headSha: gitHead.stdout.trim() || null,
    dirtyStatus: gitStatus.stdout.trim().split("\n").filter(Boolean),
  },
  runtime: {
    node: nodeVersion.stdout.trim() || null,
    npm: npmVersion.stdout.trim() || null,
  },
  suppliedProcessEnvKeys: ["RATE_LIMIT_HASH_SECRET"].filter((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim() !== "";
  }),
  tracker: {
    path: relative(repoRoot, trackerPath),
    sha256: hashFile(trackerPath),
  },
  buildArtifact: {
    buildIdPath: existsSync(buildIdPath) ? relative(repoRoot, buildIdPath) : null,
    buildIdSha256: hashFile(buildIdPath),
  },
  validations: validations.map((entry) => ({
    command: entry.command,
    exitCode: entry.exitCode,
    signal: entry.signal,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    outputSha256: createHash("sha256").update(commandText(entry)).digest("hex"),
    stdoutTail: entry.stdout.slice(-4000),
    stderrTail: entry.stderr.slice(-4000),
    error: entry.error,
  })),
  releaseChecks: Object.fromEntries(
    Object.entries(releaseChecks).map(([name, entry]) => [
      name,
      {
        command: entry.command,
        exitCode: entry.exitCode,
        signal: entry.signal,
        startedAt: entry.startedAt,
        finishedAt: entry.finishedAt,
        outputSha256: createHash("sha256").update(commandText(entry)).digest("hex"),
        stdoutTail: entry.stdout.slice(-4000),
        stderrTail: entry.stderr.slice(-4000),
        error: entry.error,
      },
    ])
  ),
};

evidence.summary = {
  allValidationExitCodesZero: evidence.validations.every((entry) => entry.exitCode === 0),
  validationCommands: evidence.validations.map((entry) => entry.command),
  productionReleaseCheckExitCode: evidence.releaseChecks.production.exitCode,
  productionReleaseCheckPassed: evidence.releaseChecks.production.exitCode === 0,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log(`Wrote ${relative(repoRoot, outputPath)}`);
console.log(`tracker_sha256=${evidence.tracker.sha256}`);
console.log(`all_validation_exit_codes_zero=${evidence.summary.allValidationExitCodesZero}`);
process.exit(evidence.summary.allValidationExitCodesZero ? 0 : 1);
