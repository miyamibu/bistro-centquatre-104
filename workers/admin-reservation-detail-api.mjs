import { runWithHyperdrive } from "./run-with-hyperdrive.mjs";
import { handler } from "../.open-next/server-functions/adminReservationDetailApi/handler.mjs";
export default { fetch: (request, env, ctx) => runWithHyperdrive(handler, request, env, ctx) };
