# Free-tier production GO

Status as of 2026-08-31: `BLOCKED_EXTERNAL_PROVIDER`.

The Netlify Free production service is deployed and operational. Administrator MFA/AAL2, exact-SHA CI, scheduler/Outbox, provider failsafe, rollback/re-promotion, Vercel retirement, and backup/restore gates have passed. Formal `PRODUCTION_GO_CONFIRMED_FREE_TIER` is withheld because five of the 22 exact requested models did not return a valid runtime response. See [production-go-execution-2026-08-31.md](evidence/production-go-execution-2026-08-31.md).

## Goal

Operate Bistro Cent Quatre 104 as a commercial production service without a paid plan, paid trial, payment card, or automatic overage while preserving reservation, order, authentication, notification, backup, and rollback safety.

## Fixed decisions

- Vercel remains Hobby. Its current non-commercial restriction means it cannot continue carrying Bistro commercial production traffic.
- Netlify Free is the selected production host. It supports commercial projects, has a hard monthly credit stop instead of paid overage, supports Next.js App Router through OpenNext, and supports scheduled functions.
- Netlify authentication, Free-plan/no-card/no-top-up confirmation, site creation, isolated environment configuration, exact-candidate Preview, and Production publication are complete.
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
4. Netlify invokes a bounded daily provider-side failsafe for reservation email,
   order notification, and LINE reminder lanes.
5. ADMIN+AAL2 users can inspect backlog/heartbeat data and perform a confirmed manual drain of at most 20 rows.
6. Claim fencing, provider idempotency keys, retry backoff, dead-letter state, and request deadlines remain the duplicate-delivery and runaway-cost boundaries.

### Scheduler operations

- Primary workflow: `.github/workflows/production-notification-outbox-drain.yml`
- Daily maintenance: `.github/workflows/production-daily-maintenance.yml` at three bounded same-JST-day recovery windows
- Provider failsafe: `netlify/functions/outbox-failsafe.mjs`
- Heartbeat warning: no successful GitHub heartbeat for either lane in more than 15 minutes
- Manual operations: `/admin/outbox`
- Manual API: `/api/admin/outbox/status` and `/api/admin/outbox/drain`

LINE’s configured monthly reminder limit is a hard application guard. At the
current release, every LINE push path is a `DAY_BEFORE_REMINDER`, so this ledger
also covers total application push consumption. If another LINE push type is
added, it must join the same global quota transaction before release; the
provider-reported total remains the independent observability check.

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

1. Completed: authenticate with Netlify without exposing tokens; confirm Free/no-card/no-top-up/no-trial.
2. Completed: create/link one site without importing secret values into source control.
3. Completed: configure Preview with an isolated database and dedicated runtime role.
4. Completed: configure required Preview and Production values, including keyrings, active IDs, `PRODUCTION_HOST_PROVIDER=netlify`, `BASE_URL`, and `NEXT_PUBLIC_APP_URL`.
5. Completed: deploy exact candidate Preview and verify public/admin/cron routes, auth boundaries, CSP, robots, sitemap, mobile UI, console, availability TTFB, function logs, and pooler concurrency.
6. Completed: the intended administrator finished password setup and TOTP enrollment; `ADMIN` and AAL2 access were verified.
7. Completed: exact release-SHA GitHub CI passed. The 22-model gate remains externally blocked at 17 valid runtime responses and five unavailable exact models.
8. Completed: deploy the fixed SHA, run non-customer canaries, and capture deployment ID, URL, SHA, headers, scheduler, and function logs.
9. Completed: restore the previous ready Production deploy, verify public routes, and re-promote the final deploy.
10. Completed: disconnect the Bistro Vercel Git integration, remove Bistro production aliases, merge PRs #2 and #3, align release main/CI/deploy/bundle evidence, and preserve the branches.

## Rollback

- Application: restore the prior Netlify deploy, then verify fingerprint and health/canary routes.
- Database: migrations are expand-only. Do not drop new tables/columns during an incident; old code ignores them.
- Scheduler: disable workflows or remove production scheduler secrets only when external calls must stop. Durable Outbox rows remain the recovery source.
- Vercel: do not promote/redeploy commercial traffic. Preserve old deployments as recovery evidence unless a later approved operation removes them.

## GO gate

`PRODUCTION_GO_CONFIRMED_FREE_TIER` is prohibited until every item in `free-tier-release-evidence.md` is PASS. The operational release gates are complete; the remaining formal blocker is valid execution evidence from all 22 exact requested models.
