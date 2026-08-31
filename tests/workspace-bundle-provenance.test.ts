import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const checkerPath = path.resolve(process.cwd(), "scripts/check-workspace-bundle-provenance.mjs");

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createBundleFixture() {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "bistro-workspace-bundle-"));
  tempDirs.push(repoDir);
  await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.name", "Bistro Test"], { cwd: repoDir });
  await execFileAsync("git", ["config", "user.email", "bistro-test@example.invalid"], { cwd: repoDir });
  await fs.writeFile(path.join(repoDir, "fixture.txt"), "approved release\n", "utf8");
  await execFileAsync("git", ["add", "fixture.txt"], { cwd: repoDir });
  await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: repoDir });
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoDir });
  const approvedHead = stdout.trim();

  const bundleDir = path.join(repoDir, "workspace-snapshots");
  const bundlePath = path.join(bundleDir, "latest.bundle");
  await fs.mkdir(bundleDir);
  await execFileAsync("git", ["bundle", "create", bundlePath, "HEAD"], { cwd: repoDir });
  const bundle = await fs.readFile(bundlePath);
  await fs.writeFile(
    path.join(bundleDir, "latest.bundle.provenance.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      head: approvedHead,
      bundleSha256: createHash("sha256").update(bundle).digest("hex"),
    })}\n`,
    "utf8"
  );

  return { repoDir, bundleDir, approvedHead };
}

describe("workspace bundle provenance", () => {
  it("accepts a verified bundle for the explicitly approved release HEAD", async () => {
    const fixture = await createBundleFixture();
    const result = await execFileAsync(
      process.execPath,
      [checkerPath, `--bundle-dir=${fixture.bundleDir}`, `--expected-head=${fixture.approvedHead}`],
      { cwd: fixture.repoDir }
    );

    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      head: fixture.approvedHead,
      expectedHead: fixture.approvedHead,
    });
  });

  it("rejects an older bundle when a different release HEAD is approved", async () => {
    const fixture = await createBundleFixture();
    await fs.appendFile(path.join(fixture.repoDir, "fixture.txt"), "new release\n", "utf8");
    await execFileAsync("git", ["add", "fixture.txt"], { cwd: fixture.repoDir });
    await execFileAsync("git", ["commit", "-m", "new release"], { cwd: fixture.repoDir });
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: fixture.repoDir });

    await expect(
      execFileAsync(
        process.execPath,
        [checkerPath, `--bundle-dir=${fixture.bundleDir}`, `--expected-head=${stdout.trim()}`],
        { cwd: fixture.repoDir }
      )
    ).rejects.toMatchObject({ code: 1 });
  });

  it("requires an explicit approved release HEAD", async () => {
    const fixture = await createBundleFixture();
    await expect(
      execFileAsync(process.execPath, [checkerPath, `--bundle-dir=${fixture.bundleDir}`], {
        cwd: fixture.repoDir,
      })
    ).rejects.toMatchObject({ code: 1 });
  });
});
