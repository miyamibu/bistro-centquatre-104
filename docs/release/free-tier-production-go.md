# Free-tier production GO

Status as of 2026-08-26: `PRE_DEPLOY_BLOCKED_USER_INTERACTION`.

## Goal

Operate Bistro Cent Quatre 104 as a commercial production service without a paid plan, paid trial, payment card, or automatic overage while preserving reservation, order, authentication, notification, backup, and rollback safety.

## Fixed decisions

- Vercel remains Hobby. Its current non-commercial restriction means it cannot continue carrying Bistro commercial production traffic.
- Netlify Free is the selected production host. It supports commercial projects, has a hard monthly credit stop instead of paid overage, supports Next.js App Router through OpenNext, and supports scheduled functions.
- Netlify account authentication and project creation remain a user-side interaction. No Preview or Production deployment is claimed before that succeeds.
- GitHub Actions on the public repository is the bounded five-minute primary Outbox scheduler. It is not a strict delivery-time guarantee; the application also performs an immediate post-response attempt and Netlify supplies one daily failsafe.
- `BASE_URL` and `NEXT_PUBLIC_APP_URL` must use the same HTTPS production origin. `PRODUCTION_HOST_PROVIDER=netlify` is mandatory for Preview and Production release checks.
- Production notification scheduling never uses Vercel Cron. `vercel.json` contains no cron jobs.
- Preview and Production email delivery use Resend so the stable Outbox key reaches a provider-native idempotency boundary. SendGrid compatibility remains local-only.
- Hard deletion of reservation, business-day, notification evidence, recovery evidence, or backup data remains prohibited.

## Implemented architecture

### Durable notification flow

1. Reservation/order state and its Outbox record commit atomically.
2. `after()` schedules a bounded post-response delivery attempt.
3. A public GitHub standard runner calls both Outbox endpoints every five minutes with a Bearer secret. It uses no checkout, cache, or artifact action.
4. Netlify invokes a bounded daily provider-side failsafe.
5. ADMIN+AAL2 users can inspect backlog/heartbeat data and perform a confirmed manual drain of at most 20 rows.
6. Claim fencing, provider idempotency keys, retry backoff, dead-letter state, and request deadlines remain the duplicate-delivery and runaway-cost boundaries.

### Scheduler operations

- Primary workflow: `.github/workflows/production-notification-outbox-drain.yml`
- Daily maintenance: `.github/workflows/production-daily-maintenance.yml`
- Provider failsafe: `netlify/functions/outbox-failsafe.mjs`
- Heartbeat warning: no successful GitHub heartbeat for either lane in more than 15 minutes
- Manual operations: `/admin/outbox`
- Manual API: `/api/admin/outbox/status` and `/api/admin/outbox/drain`

GitHub scheduled workflows only run from the default branch and may be delayed or dropped. After the workflow reaches `main`, run `workflow_dispatch` once and capture at least one real scheduled run before declaring GO.

### Origin migration

The canonical URL helper resolves `NEXT_PUBLIC_APP_URL`, then Netlify-provided `URL`, then the legacy Vercel URL as a build-safe fallback only. Preview/Production release checks reject a Vercel origin, require HTTPS and matching `BASE_URL`/`NEXT_PUBLIC_APP_URL`, and require `PRODUCTION_HOST_PROVIDER=netlify`. The legacy fallback can therefore never pass the deployment gate.

After Netlify allocates a URL, update Supabase Auth redirect URLs, LINE LIFF endpoints and webhook URL, GitHub `PRODUCTION_BASE_URL`, Netlify origin variables, any custom-domain DNS, and the old Vercel alias/traffic setting. Secret values must not enter Git, logs, or chat.

### Keyring and backup contract

- Reservation and backup encryption use JSON keyrings with explicit active key IDs; legacy single-key values remain readable for compatibility.
- macOS Keychain holds local operator copies; secret values are never written to release evidence.
- Reservation backup schema v4 includes management-token hashes and reservation idempotency records.
- Encrypted-file SHA-256 covers the exact bytes written, including the final newline.
- The three independent lanes are reservation export, workspace bundle, and restore/validation evidence.

### Production database safety

- The scheduler/audit migration is additive and forward-compatible; both new tables have RLS.
- The runtime role has no `DELETE` or `TRUNCATE` privilege on protected business/audit tables.
- The obsolete runtime delete policy on `ReservationLineLinkToken` is removed.
- Production verification checks tables, RLS, policies, functions, FK delete actions, grants, and destructive runtime policies.

## Netlify Preview and production procedure

1. Authenticate with Netlify using the browser flow; never paste tokens into chat.
2. Create/link one Free site without importing secret values into source control.
3. Configure Preview with a non-production database or an explicitly read-only safe connection.
4. Configure all required values in `.env.example`, including both keyrings, active IDs, `PRODUCTION_HOST_PROVIDER=netlify`, `BASE_URL`, and `NEXT_PUBLIC_APP_URL`.
5. Run `npm run check:release:preview`, deploy Preview, and verify public/admin/cron routes, auth, CSP, robots, sitemap, mobile/desktop, console, TTFB, and rollback.
6. Fix all Preview findings before configuring Production.
7. Deploy the fixed candidate SHA, execute synthetic canaries that cannot notify real customers, and capture deployment ID, URL, SHA, build, headers, and logs.
8. Exercise provider rollback against the prior deployment or an isolated Preview; knowing a command is not evidence.
9. Only after every gate passes, merge PR #2 with a merge commit and keep the branch.
10. Align local HEAD, PR head/merge SHA, `origin/main`, CI SHA, workspace bundle HEAD, deployed SHA, and public fingerprint.

## Rollback

- Application: restore the prior Netlify deploy, then verify fingerprint and health/canary routes.
- Database: migrations are expand-only. Do not drop new tables/columns during an incident; old code ignores them.
- Scheduler: disable workflows or remove production scheduler secrets only when external calls must stop. Durable Outbox rows remain the recovery source.
- Vercel: do not promote/redeploy commercial traffic. Preserve old deployments as recovery evidence unless a later approved operation removes them.

## GO gate

`PRODUCTION_GO_CONFIRMED_FREE_TIER` is prohibited until every item in `free-tier-release-evidence.md` is PASS, including authenticated Preview/Production, a real scheduled heartbeat, rollback exercise, Nemotron post-fix audit, PR merge, and production/main SHA alignment.
