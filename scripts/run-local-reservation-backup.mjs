#!/usr/bin/env node

import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import process from "node:process";

const execFileAsync = promisify(execFile);

const HOST = "127.0.0.1";
const DEFAULT_PORT = 3100;
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 1_000;
const ROUTE_PATH = "/api/admin/backups/reservations/export";

function parseCliArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const normalized = token.slice(2);
    const eqIndex = normalized.indexOf("=");
    if (eqIndex >= 0) {
      args.set(normalized.slice(0, eqIndex), normalized.slice(eqIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(normalized, "true");
      continue;
    }
    args.set(normalized, next);
    index += 1;
  }
  return args;
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, HOST);
  });
}

async function pickPort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`利用可能なローカルポートが見つかりません: ${preferredPort}-${preferredPort + 19}`);
}

function appendRing(buffer, chunk) {
  buffer.push(chunk.toString());
  while (buffer.length > 80) buffer.shift();
}

async function waitForRoute(baseUrl, serverLog) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const url = `${baseUrl}${ROUTE_PATH}?date=2026-01-01`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
      });
      if (response.status === 401 || response.headers.get("content-type")?.includes("application/json")) {
        return;
      }
    } catch {
      // Next dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  throw new Error(
    `ローカルバックアップAPIが起動確認できませんでした。recent server log: ${serverLog.join("").slice(-1200)}`
  );
}

async function runCommand(cmd, args, cwd, env) {
  const result = await execFileAsync(cmd, args, {
    cwd,
    env,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.stdout.trim()) process.stdout.write(result.stdout);
  if (result.stderr.trim()) process.stderr.write(result.stderr);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function main() {
  const cwd = process.cwd();
  const cli = parseCliArgs(process.argv.slice(2));
  const preferredPort = Number(cli.get("port") ?? process.env.BACKUP_LOCAL_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(preferredPort) || preferredPort <= 0) {
    throw new Error("--port / BACKUP_LOCAL_PORT は有効なポート番号を指定してください");
  }

  const outDir = cli.get("out-dir") ?? "backups/reservation-daily-backups";
  const port = await pickPort(preferredPort);
  const baseUrl = `http://${HOST}:${port}`;
  const serverLog = [];

  console.info(`[backup:local] Next dev server を起動します: ${baseUrl}`);
  const server = spawn("npm", ["run", "dev", "--", "--hostname", HOST, "--port", String(port)], {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => appendRing(serverLog, chunk));
  server.stderr.on("data", (chunk) => appendRing(serverLog, chunk));

  try {
    await waitForRoute(baseUrl, serverLog);
    console.info("[backup:local] ローカルバックアップAPIの起動を確認しました");

    await runCommand(
      "node",
      [
        "--import",
        "tsx",
        "scripts/pull-reservation-backups.ts",
        `--base-url=${baseUrl}`,
        `--out-dir=${outDir}`,
      ],
      cwd,
      process.env
    );

    await runCommand(
      "npm",
      ["run", "backup:reservations:cleanup", "--", `--out-dir=${outDir}`],
      cwd,
      process.env
    );
  } finally {
    await stopServer(server);
    console.info("[backup:local] Next dev server を停止しました");
  }
}

main().catch((error) => {
  console.error(`[backup:local] 失敗: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
