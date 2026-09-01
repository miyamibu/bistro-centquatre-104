import { runWithHyperdrive } from "./run-with-hyperdrive.mjs";
import { handler } from "../.open-next/server-functions/lineApi/handler.mjs";

export default { fetch: (request, env, ctx) => runWithHyperdrive(handler, request, env, ctx) };
