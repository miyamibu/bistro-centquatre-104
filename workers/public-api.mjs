import { runWithHyperdrive } from "./run-with-hyperdrive.mjs";
import { handler } from "../.open-next/server-functions/publicApi/handler.mjs";

export default { fetch: (request, env, ctx) => runWithHyperdrive(handler, request, env, ctx) };
