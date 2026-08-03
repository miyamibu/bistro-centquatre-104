# Production Launch Runbook

This runbook is the release path for `bistro-reservation`.

## P0 release blockers as of 2026-04-22

Do not treat the older 2026-03-03 local verification alone as launch approval. The current release remains blocked until the following reservation-safety controls are complete or explicitly accepted by the operator.

1. Reservation, private-block, and business-day destructive-operation guards are documented and enforced in the repo.
2. Ordinary reservation state changes (`CANCELLED`, `DONE`, `NOSHOW`) are tracked by application audit logs, and private-block release continues to write DB audit rows.
3. `npm run security:destructive-reservations` passes in CI and on the release candidate branch.
4. Production DB permission hardening is applied or scheduled so the runtime app user does not have `DELETE` / `TRUNCATE` on `Reservation`, `PrivateBlockAuditLog`, or `BusinessDay`.
5. Cleanup and cron behavior is reviewed as non-destructive for reservation business data, recovery evidence, and backups.
6. Backup retention keeps reservation backups and recovery evidence preserved via archive or documented retention flow, not hard delete.

See also `docs/recovery/production-db-permissions.md` for the DB role split and SQL examples.

## What has been verified locally

Run the following checks from the repo root for a release candidate:

1. `npm run check:release:production` (use `VERCEL_PLAN=pro` while the 5-minute cron is present)
2. `npm run lint`
3. `npm run typecheck`
4. `npm run security:env`
5. `npm run security:destructive-reservations`
6. `npm run test`
7. `npm run build`
8. Production smoke tests against `next start`

The production smoke checks confirmed:

1. `GET /ai` returns `308` and redirects to `/agents`
2. `GET /?ai=1` returns `307` and redirects to `/agents`
3. `GET /` returns `200` and includes `Link` headers for `/agents`, `/llms.txt`, and `/api/agent`
4. `GET /admin/reservations` redirects to `/admin/login` without a valid staff session
5. `GET /api/agent?pretty=1` returns `200`

## Required production environment

Set these values in your hosting provider before the production deploy:

1. `DATABASE_URL`
2. `DIRECT_URL`（Prisma migration用の直接接続。`DATABASE_URL`と同じDBを指す）
3. `BASE_URL`
4. `NEXT_PUBLIC_SUPABASE_URL`
5. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
6. `SUPABASE_SERVICE_ROLE_KEY`
7. `STAFF_SESSION_MAX_AGE_SECONDS`
8. `CRON_SECRET`
9. `BACKUP_EXPORT_SECRET`
10. `RATE_LIMIT_HASH_SECRET`
11. `RESERVATION_TOKEN_KEYS_JSON` + `RESERVATION_TOKEN_ACTIVE_KEY_ID`（または移行用 `RESERVATION_TOKEN_SECRET`）
12. `BACKUP_ENCRYPTION_KEYS_JSON` + `BACKUP_ENCRYPTION_ACTIVE_KEY_ID`（または移行用 `BACKUP_ENCRYPTION_KEY`）
13. `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY`

Recommended operational values:

1. `STORE_NOTIFY_EMAIL`
2. `EMAIL_PROVIDER`
3. `EMAIL_FROM`
4. `ADMIN_EMAIL`
5. `STORE_NAME`
6. `BANK_ACCOUNT_HISTORY_KEY_VERSION`
7. `CONTACT_PHONE_E164`
8. `CONTACT_PHONE_DISPLAY`
9. `CONTACT_MESSAGE`
10. `NEXT_PUBLIC_CONTACT_PHONE_E164`
11. `NEXT_PUBLIC_CONTACT_PHONE_DISPLAY`
12. `NEXT_PUBLIC_CONTACT_MESSAGE`
13. `LINE_CHANNEL_ACCESS_TOKEN`
14. `LINE_CHANNEL_SECRET`
15. `LINE_LOGIN_CHANNEL_ID`
16. `NEXT_PUBLIC_LIFF_BOOKING_ID` — Booking LIFF endpoint: `https://本番ドメイン/booking` (size=Full, scopes=openid profile)
17. `NEXT_PUBLIC_LIFF_LINK_ID`    — Link LIFF endpoint: `https://本番ドメイン/line/link` (size=Full, scopes=openid profile)
18. `LINE_LINK_TOKEN_PEPPER`      — 32 文字以上のランダム文字列 (必須)
19. `LINE_MONTHLY_REMINDER_LIMIT` — 月間通知上限 (省略時 200)
20. `LINE_MONTHLY_REMINDER_WARN_THRESHOLD` — 警告閾値 (省略時 180)
    ※ `LIFF_ID` (旧名) は廃止。設定不要。

Email provider notes:

1. If `EMAIL_PROVIDER=resend`, set `RESEND_API_KEY`. `EMAIL_API_KEY` is accepted only as fallback.
2. If `EMAIL_PROVIDER=sendgrid`, set `EMAIL_API_KEY`.
3. Contact and order confirmation APIs are fail-closed for delivery. Missing/invalid mail config is returned as API error.
4. Reservation confirmation email is enqueued atomically with the reservation and processed by `/api/crons/process-reservation-emails`.
5. Apply `20260728090000_add_reservation_email_outbox` and the following
   `20260728093000_restrict_reservation_related_deletes` Prisma migrations before deploying
   code that creates reservations.
6. Apply `20260803090000_customer_contact_policy_token_keyring` before enabling customer email,
   24-hour cancellation cutoff, or token-key rotation. This migration adds customer contact,
   cancellation audit, and token key-id columns.
7. Apply `20260803100000_rename_private_block_audit_staff_source` immediately after the
   customer-contact migration so existing private-block audit rows use the current
   `ADMIN_USER` source name.
8. Apply `supabase/migrations/20260728230000_harden_order_notification_outbox.sql`
   after the existing order outbox migration and before deploying the order worker.
9. Apply `supabase/rls-policies.sql`, then run `supabase/verify.sql` with
   `psql -v ON_ERROR_STOP=1` in a read-only transaction. Do not proceed until
   the assertions pass.
10. See `docs/reservation-email-outbox.md` for retry, dead-letter, and safe rollout behavior.

Customer reservation policy:

1. Reservation creation requires a customer email, unless a verified LINE identity is attached.
2. The customer confirmation email is enqueued transactionally and contains a 180-day management link.
3. Self-service cancellation is free until 24 hours before the stored arrival time (JST); the current system has no cancellation-fee setting or automatic charge.
4. After the cutoff, the API returns `CANCELLATION_CUTOFF_PASSED` and directs the customer to phone support.
5. Every cancellation stores `cancelledAt`, `cancelSource`, `cancellationReason`, and a status audit row.

Bank account history note:

1. `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY` is required and dedicated to bank history encryption.
2. The app does not fall back to other secrets.

Supabase notes:

1. The Supabase project must be resumed and reachable before launch.
2. `NEXT_PUBLIC_SUPABASE_URL` must be the real project URL, not a placeholder.
3. `SUPABASE_SERVICE_ROLE_KEY` must be the real service role key.

## Preview environment

Preview smoke and runtime verification need the same required key structure as `Production`, even when the values point at staging resources instead of live ones.

Set these keys in Vercel Preview before relying on preview deploys:

1. `DATABASE_URL`
2. `DIRECT_URL`（Preview/staging DBへの直接接続）
3. `BASE_URL`
4. `NEXT_PUBLIC_SUPABASE_URL`
5. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
6. `SUPABASE_SERVICE_ROLE_KEY`
7. `STAFF_SESSION_MAX_AGE_SECONDS`
8. `CRON_SECRET`
9. `BACKUP_EXPORT_SECRET`
10. `RATE_LIMIT_HASH_SECRET`
11. `RESERVATION_TOKEN_KEYS_JSON` + `RESERVATION_TOKEN_ACTIVE_KEY_ID`（または `RESERVATION_TOKEN_SECRET`）
12. `BACKUP_ENCRYPTION_KEYS_JSON` + `BACKUP_ENCRYPTION_ACTIVE_KEY_ID`（または `BACKUP_ENCRYPTION_KEY`）
13. `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY`

Safe default:

1. Use a preview or staging database instead of the live production database
2. Use preview/staging Supabase credentials instead of the production service role key
3. Keep Preview verification read-only when possible

## One-time database preparation

Run Prisma production migrations against the production database:

```powershell
cd c:\Users\mibum\Desktop\french-restaurant-site\bistro-reservation
npx prisma migrate deploy
```

Ensure the remote Supabase project has the required SQL applied:

1. `supabase/schema.sql`
2. `supabase/rls-policies.sql`
3. `supabase/verify.sql`

## Local preflight before every release

Run the automated preflight from the repo root:

```powershell
cd c:\Users\mibum\Desktop\french-restaurant-site\bistro-reservation
powershell -ExecutionPolicy Bypass -File .\scripts\prelaunch-check.ps1
```

Optional custom port:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prelaunch-check.ps1 -Port 3200
```

Before running release checks, confirm the Git working tree is clean enough for release:

```bash
git status --short --branch
```

Do not deploy from a dirty tree that includes untracked `src/app/*` routes or other release-unrelated files.  
Local CLI deploys can upload those files even when they are not committed.

This script validates:

1. Required env keys are present and not obvious placeholders
2. Values can come from `.env`, `.env.local`, or the current shell environment
3. `npm run lint`
4. `npm run typecheck`
5. `npm run test`
6. `npm run build`
7. `npm run security:destructive-reservations`
8. `next start` smoke checks for `/agents`, `/ai`, `/?ai=1`, `/api/agent`, and the Supabase staff login redirect
9. `POST /api/reservations` requires same-origin `Origin`, `X-Requested-With: XMLHttpRequest`, and `Idempotency-Key`

For a faster cross-platform env check before the full preflight, run:

```bash
npm run check:release
```

For preview-specific reminders:

```bash
npm run check:release:preview
```

## Vercel deployment

This repo already includes `vercel.json` cron definitions.

For the exact production env paste order, use `docs/vercel-production-env.md`.
To check which local values are present without printing secrets, run `.\scripts\print-vercel-env.ps1`.

Use these production settings:

1. Framework preset: `Next.js`
2. Root directory: `bistro-reservation`
3. Install command: `npm install`
4. Build command: `npm run build`
5. Output directory: `.next`

Deploy sequence:

1. Push the release commit to the production branch
2. Open the Vercel project
3. Confirm all production env vars are set
4. Confirm the production domain is the same value used in `BASE_URL`
5. Trigger a production deployment
6. Wait for build completion

CLI note:

1. `vercel deploy` on a team project can be rejected when the local Git author email is not recognized by that Vercel team
2. Before relying on CLI preview deploys, confirm `git config user.email` is your Vercel team email, not a local machine address such as `name@host.local`
3. If CLI preview is blocked by author enforcement, use the Git-integrated deploy flow or correct the Git author before retrying

Cron notes:

1. Vercel will call the paths declared in `vercel.json`
2. Cron endpoints still require the correct `CRON_SECRET` logic inside the route handlers
3. Do not remove `CRON_SECRET` after deploy
4. `cancel-expired-orders` is bounded to 200 orders per run and can be safely rerun
5. `delete-old-histories` deletes up to 1000 rows per run in 200-row batches
6. `process-reservation-emails` claims at most 10 due rows per run and retries failed delivery up to 5 attempts.
7. `process-order-notifications` runs daily at `0 2 * * *`.
8. `process-reservation-emails` runs at `*/5 * * * *`; this requires a Vercel Pro plan (Hobby is incompatible).
9. Run `VERCEL_PLAN=pro npm run check:release:production` before enabling the 5-minute schedule.
   If `VERCEL_PLAN` is unknown, the production release check fails rather than assuming plan support.

## Post-deploy smoke checks

Replace `https://your-domain.example` with the production domain and run:

```powershell
curl.exe -I "https://your-domain.example/ai"
curl.exe -I "https://your-domain.example/?ai=1"
curl.exe -I "https://your-domain.example/"
curl.exe -I "https://your-domain.example/admin/reservations"
curl.exe "https://your-domain.example/api/agent?pretty=1"
curl.exe "https://your-domain.example/llms.txt"
```

Expected results:

1. `/ai` -> `308` to `/agents`
2. `/?ai=1` -> `307` to `/agents`
3. `/` -> `200` with `Link` headers
4. `/admin/reservations` -> redirect to `/admin/login` without a staff session
5. `/api/agent?pretty=1` -> `200`
6. `/llms.txt` -> `200`

Reservation API probe:

```powershell
curl.exe -s -X POST "https://your-domain.example/api/reservations" ^
  -H "Content-Type: application/json" ^
  -H "Origin: https://your-domain.example" ^
  -H "X-Requested-With: XMLHttpRequest" ^
  -H "Idempotency-Key: prelaunch-validation-probe" ^
  -d "{}"
```

The probe should return `400` with `code=VALIDATION_ERROR`. The explicit same-origin
`Origin`, `X-Requested-With`, and `Idempotency-Key` headers are intentional; without them the request may
be rejected by the API security boundary before body validation.

## Human QA after deploy

Confirm these manually in a browser:

1. `/agents`
2. `/booking`
3. `/on-line-store`
4. `/on-line-store/apron?mode=agent&qty=2`
5. `/on-line-store/cart?mode=agent`
6. `/admin/login` -> sign in with an individual Supabase Auth user, complete TOTP MFA, then open `/dashboard/orders`
7. `/admin/reservations` -> staff user sees reservations; a user without `app_metadata.role` is denied

## Rollback

If the deploy is bad:

1. Re-deploy the previous successful production deployment in Vercel
2. Keep the same production env vars unless the failure came from env changes
3. If the failure came from a Prisma migration, restore from database backup instead of editing production tables by hand
