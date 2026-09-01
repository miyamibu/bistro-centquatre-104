import fs from "node:fs/promises";
import path from "node:path";

import { bundleServer } from "../node_modules/@opennextjs/cloudflare/dist/cli/build/bundle-server.js";
import {
  compileConfig,
  getNormalizedOptions,
} from "../node_modules/@opennextjs/cloudflare/dist/cli/commands/utils/utils.js";

const { config, buildDir } = await compileConfig();
const buildOptions = getNormalizedOptions(config, buildDir);
const functionsDir = path.join(buildOptions.outputDir, "server-functions");
const functionNames = (await fs.readdir(functionsDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== "default")
  .map((entry) => entry.name)
  .sort();
const defaultDir = path.join(functionsDir, "default");
const heldDefaultDir = path.join(functionsDir, ".default-held-for-split-bundle");

for (const functionName of functionNames) {
  const functionDir = path.join(functionsDir, functionName);

  await fs.access(path.join(functionDir, "index.mjs"));
  await fs.rename(defaultDir, heldDefaultDir);
  await fs.rename(functionDir, defaultDir);

  try {
    await bundleServer(buildOptions, {
      minify: true,
      sourceDir: process.cwd(),
    });
  } finally {
    await fs.rename(defaultDir, functionDir);
    await fs.rename(heldDefaultDir, defaultDir);
  }
}
