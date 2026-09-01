import {
  defineCloudflareConfig,
  type OpenNextConfig,
} from "@opennextjs/cloudflare";

const base = defineCloudflareConfig();

const operationsApiRoutes = [
  "app/api/admin/business-days/route",
  "app/api/admin/daily-journal/route",
  "app/api/admin/day-status/route",
  "app/api/admin/private-block/route",
] as const;

const outboxApiRoutes = [
  "app/api/admin/outbox/drain/route",
  "app/api/admin/outbox/status/route",
] as const;

const backupApiRoutes = ["app/api/admin/backups/reservations/export/route"] as const;

const adminReservationsApiRoutes = [
  "app/api/admin/reservations/route",
] as const;

const adminReservationDetailApiRoutes = [
  "app/api/admin/reservations/[id]/route",
] as const;

const adminReservationCorrectionApiRoutes = [
  "app/api/admin/reservations/[id]/correction/route",
] as const;

const cronApiRoutes = [
  "app/api/crons/cancel-expired-orders/route",
  "app/api/crons/delete-old-histories/route",
] as const;

const notificationCronApiRoutes = [
  "app/api/cron/remind/route",
  "app/api/crons/process-reservation-emails/route",
  "app/api/crons/remind/route",
] as const;

const orderNotificationCronApiRoutes = [
  "app/api/crons/process-order-notifications/route",
] as const;

const ordersApiRoutes = [
  "app/api/orders/route",
] as const;

const orderActionsApiRoutes = ["app/api/orders/[id]/actions/route"] as const;

const orderReceiptApiRoutes = ["app/api/orders/[id]/receipt/route"] as const;

const dashboardApiRoutes = [
  "app/api/dashboard/bank-account/route",
  "app/api/dashboard/orders/route",
  "app/dashboard/api/bank-account/route",
  "app/dashboard/api/orders/route",
] as const;

const lineApiRoutes = [
  "app/api/line/customer-link/route",
  "app/api/line/link-reservation/route",
  "app/api/line/webhook/route",
] as const;

const mediaApiRoutes = ["app/api/pdf-to-image/route"] as const;

const publicApiRoutes = [
  "app/api/daily-journal/route",
  "app/api/private-block/access/route",
  "app/auth/callback/route",
  "app/llms.txt/route",
] as const;

const contactApiRoutes = ["app/api/contact/route"] as const;

const agentApiRoutes = ["app/api/agent/route"] as const;

const availabilityApiRoutes = [
  "app/api/availability/monthly/route",
  "app/api/availability/route",
] as const;

const reservationsApiRoutes = [
  "app/api/reservations/manage/route",
  "app/api/reservations/route",
] as const;

const adminApplicationRoutes = [
  "app/admin/business-days/page",
  "app/admin/daily-journal/page",
  "app/admin/login/page",
  "app/admin/mfa/setup/page",
  "app/admin/outbox/page",
  "app/admin/page",
  "app/admin/password-reset/page",
  "app/admin/reservations/[id]/page",
  "app/admin/reservations/page",
] as const;

const customerApplicationRoutes = [
  "app/auth/recovery/page",
  "app/booking/page",
  "app/dashboard/orders/page",
  "app/reservation/manage/page",
  "app/staff/page",
] as const;

export default {
  ...base,
  functions: {
    operationsApi: {
      ...base.default,
      routes: [...operationsApiRoutes],
      patterns: ["/api/admin/*"],
    },
    outboxApi: {
      ...base.default,
      routes: [...outboxApiRoutes],
      patterns: ["/api/admin/outbox/*"],
    },
    backupApi: {
      ...base.default,
      routes: [...backupApiRoutes],
      patterns: ["/api/admin/backups/*"],
    },
    adminReservationsApi: {
      ...base.default,
      routes: [...adminReservationsApiRoutes],
      patterns: ["/api/admin/reservations/*"],
    },
    adminReservationDetailApi: {
      ...base.default,
      routes: [...adminReservationDetailApiRoutes],
      patterns: ["/api/admin/reservations/*"],
    },
    adminReservationCorrectionApi: {
      ...base.default,
      routes: [...adminReservationCorrectionApiRoutes],
      patterns: ["/api/admin/reservations/*/correction"],
    },
    cronApi: {
      ...base.default,
      routes: [...cronApiRoutes],
      patterns: ["/api/cron/*", "/api/crons/*"],
    },
    notificationCronApi: {
      ...base.default,
      routes: [...notificationCronApiRoutes],
      patterns: [
        "/api/cron/remind",
        "/api/crons/process-order-notifications",
        "/api/crons/process-reservation-emails",
        "/api/crons/remind",
      ],
    },
    orderNotificationCronApi: {
      ...base.default,
      routes: [...orderNotificationCronApiRoutes],
      patterns: ["/api/crons/process-order-notifications"],
    },
    ordersApi: {
      ...base.default,
      routes: [...ordersApiRoutes],
      patterns: ["/api/orders/*"],
    },
    orderActionsApi: {
      ...base.default,
      routes: [...orderActionsApiRoutes],
      patterns: ["/api/orders/*/actions"],
    },
    orderReceiptApi: {
      ...base.default,
      routes: [...orderReceiptApiRoutes],
      patterns: ["/api/orders/*/receipt"],
    },
    dashboardApi: {
      ...base.default,
      routes: [...dashboardApiRoutes],
      patterns: ["/api/dashboard/*", "/dashboard/api/*"],
    },
    lineApi: {
      ...base.default,
      routes: [...lineApiRoutes],
      patterns: ["/api/line/*"],
    },
    mediaApi: {
      ...base.default,
      routes: [...mediaApiRoutes],
      patterns: ["/api/pdf-to-image"],
    },
    publicApi: {
      ...base.default,
      routes: [...publicApiRoutes],
      patterns: [
        "/api/agent",
        "/api/contact",
        "/api/daily-journal",
        "/api/private-block/*",
        "/auth/callback",
        "/llms.txt",
      ],
    },
    contactApi: {
      ...base.default,
      routes: [...contactApiRoutes],
      patterns: ["/api/contact"],
    },
    agentApi: {
      ...base.default,
      routes: [...agentApiRoutes],
      patterns: ["/api/agent"],
    },
    availabilityApi: {
      ...base.default,
      routes: [...availabilityApiRoutes],
      patterns: ["/api/availability/*"],
    },
    reservationsApi: {
      ...base.default,
      routes: [...reservationsApiRoutes],
      patterns: ["/api/reservations/*"],
    },
    adminApplication: {
      ...base.default,
      routes: [...adminApplicationRoutes],
      patterns: ["/admin/*"],
    },
    customerApplication: {
      ...base.default,
      routes: [...customerApplicationRoutes],
      patterns: ["/auth/recovery", "/booking", "/dashboard/*", "/reservation/*", "/staff"],
    },
  },
} satisfies OpenNextConfig;
