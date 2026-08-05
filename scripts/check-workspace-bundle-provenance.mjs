#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function readOption(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const expectedHead = readOption("expected-head");
  if (!expectedHead || !/^[0-9a-f]{40}$/.test(expectedHead)) {
    throw new Error("--expected-head=<approved 40-character Git SHA> is required");
  }

  const bundleDir = path.resolve(process.cwd(), readOption("bundle-dir") ?? "backups/workspace-snapshots");
  const bundlePath = path.join(bundleDir, "latest.bundle");
  const provenancePath = path.join(bundleDir, "latest.bundle.provenance.json");
  const [bundle, provenanceRaw] = await Promise.all([fs.readFile(bundlePath), fs.readFile(provenancePath, "utf8")]);
  const provenance = JSON.parse(provenanceRaw);

  if (!provenance || typeof provenance !== "object" || !/^[0-9a-f]{40}$/.test(provenance.head) || !/^[0-9a-f]{64}$/.test(provenance.bundleSha256)) {
    throw new Error("workspace bundle provenance metadata is invalid");
  }
  if (provenance.head !== expectedHead) {
    throw new Error("workspace bundle HEAD does not match the approved release HEAD");
  }
  const actualSha256 = createHash("sha256").update(bundle).digest("hex");
  if (actualSha256 !== provenance.bundleSha256) {
    throw new Error("workspace bundle SHA-256 does not match provenance");
  }

  await execFileAsync("git", ["bundle", "verify", bundlePath], { cwd: process.cwd() });
  const { stdout } = await execFileAsync("git", ["bundle", "list-heads", bundlePath], { cwd: process.cwd() });
  if (!stdout.split(/\r?\n/).some((line) => line.startsWith(`${provenance.head} `))) {
    throw new Error("release HEAD SHA is not present in workspace bundle");
  }

  console.info(JSON.stringify({ ok: true, bundlePath, head: provenance.head, expectedHead, bundleSha256: actualSha256 }, null, 2));
}

main().catch((error) => {
  console.error(`[backup:workspace:status] 失敗: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
