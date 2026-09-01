import { runWithCloudflareRequestContext } from "../.open-next/cloudflare/init.js";

export function runWithHyperdrive(handler, request, env, ctx) {
  globalThis.__BISTRO_HYPERDRIVE_CONNECTION_STRING__ = env.HYPERDRIVE?.connectionString;
  return runWithCloudflareRequestContext(request, env, ctx, () => handler(request, env, ctx));
}
