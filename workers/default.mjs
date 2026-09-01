import { runWithCloudflareRequestContext } from "../.open-next/cloudflare/init.js";
import { handler } from "../.open-next/server-functions/default/handler.mjs";

function selectApplication(env, pathname) {
  if (pathname.startsWith("/api/admin/backups/")) return env.BACKUP_API;
  if (pathname.startsWith("/api/admin/outbox/")) return env.OUTBOX_API;
  if (/^\/api\/admin\/reservations\/[^/]+\/correction$/.test(pathname)) return env.ADMIN_RESERVATION_CORRECTION_API;
  if (/^\/api\/admin\/reservations\/[^/]+/.test(pathname)) return env.ADMIN_RESERVATION_DETAIL_API;
  if (pathname.startsWith("/api/admin/reservations")) return env.ADMIN_RESERVATIONS_API;
  if (pathname.startsWith("/api/admin/")) return env.OPERATIONS_API;
  if (pathname === "/api/crons/process-order-notifications") return env.ORDER_NOTIFICATION_CRON_API;
  if (pathname === "/api/cron/remind" || pathname.startsWith("/api/crons/process-") || pathname === "/api/crons/remind") return env.NOTIFICATION_CRON_API;
  if (pathname.startsWith("/api/cron/") || pathname.startsWith("/api/crons/")) return env.CRON_API;
  if (pathname.startsWith("/api/dashboard/")) return env.DASHBOARD_API;
  if (pathname.startsWith("/api/line/")) return env.LINE_API;
  if (/^\/api\/orders\/[^/]+\/receipt$/.test(pathname)) return env.ORDER_RECEIPT_API;
  if (/^\/api\/orders\/[^/]+\/actions$/.test(pathname)) return env.ORDER_ACTIONS_API;
  if (pathname.startsWith("/api/orders")) return env.ORDERS_API;
  if (pathname === "/api/pdf-to-image") return env.MEDIA_API;
  if (pathname.startsWith("/dashboard/api/")) return env.DASHBOARD_API;
  if (pathname.startsWith("/api/reservations")) return env.RESERVATIONS_API;
  if (pathname.startsWith("/api/availability")) return env.AVAILABILITY_API;
  if (pathname === "/api/agent") return env.AGENT_API;
  if (pathname === "/api/contact") return env.CONTACT_API;
  if (pathname.startsWith("/api/") || pathname === "/auth/callback" || pathname === "/llms.txt") return env.PUBLIC_API;
  if (pathname.startsWith("/admin")) return env.ADMIN_APPLICATION;
  if (pathname === "/booking" || pathname.startsWith("/dashboard/")) return env.CUSTOMER_APPLICATION;
  if (pathname.startsWith("/reservation/") || pathname === "/staff" || pathname === "/auth/recovery") return env.CUSTOMER_APPLICATION;
  return null;
}

function withReleaseSha(response, releaseSha) {
  if (!releaseSha) return response;
  const released = new Response(response.body, response);
  released.headers.set("X-Bistro-Release-SHA", releaseSha);
  return released;
}

export default {
  async fetch(request, env, ctx) {
    globalThis.__BISTRO_HYPERDRIVE_CONNECTION_STRING__ = env.HYPERDRIVE?.connectionString;
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/release") {
      return Response.json(
        {
          releaseSha: env.RELEASE_SHA ?? null,
          workerVersionId: env.CF_VERSION_METADATA?.id ?? null,
          deployedAt: env.CF_VERSION_METADATA?.timestamp ?? null,
        },
        {
          headers: env.RELEASE_SHA
            ? { "X-Bistro-Release-SHA": env.RELEASE_SHA, "Cache-Control": "no-store" }
            : { "Cache-Control": "no-store" },
        },
      );
    }
    const application = selectApplication(env, pathname);
    const response = application
      ? await application.fetch(request)
      : await runWithCloudflareRequestContext(request, env, ctx, () => handler(request, env, ctx));
    return withReleaseSha(response, env.RELEASE_SHA);
  },
};
