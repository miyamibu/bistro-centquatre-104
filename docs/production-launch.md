# Production Launch Runbook

This runbook is the release path for `bistro-reservation`.

## What has been verified locally

As of 2026-03-03, the following checks passed from the repo root:

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. Production smoke tests against `next start`

The production smoke checks confirmed:

1. `GET /ai` returns `308` and redirects to `/agents`
2. `GET /?ai=1` returns `307` and redirects to `/agents`
3. `GET /` returns `200` and includes `Link` headers for `/agents`, `/llms.txt`, and `/api/agent`
4. `GET /admin/reservations` returns `401` without Basic auth
5. `GET /api/agent?pretty=1` returns `200`

## Required production environment

Set these values in your hosting provider before the production deploy:

1. `DATABASE_URL`
2. `BASE_URL`
3. `ADMIN_BASIC_USER`
4. `ADMIN_BASIC_PASS`
5. `NEXT_PUBLIC_SUPABASE_URL`
6. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
7. `SUPABASE_SERVICE_ROLE_KEY`
8. `CRON_SECRET`
9. `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY`

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
15. `LIFF_ID`

Email provider notes:

1. If `EMAIL_PROVIDER=resend`, set `RESEND_API_KEY`. `EMAIL_API_KEY` is accepted only as fallback.
2. If `EMAIL_PROVIDER=sendgrid`, set `EMAIL_API_KEY`.
3. Contact and order confirmation APIs are fail-closed for delivery. Missing/invalid mail config is returned as API error.

Bank account history note:

1. `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY` is required and dedicated to bank history encryption.
2. The app does not fall back to other secrets.

Supabase notes:

1. The Supabase project must be resumed and reachable before launch.
2. `NEXT_PUBLIC_SUPABASE_URL` must be the real project URL, not a placeholder.
3. `SUPABASE_SERVICE_ROLE_KEY` must be the real service role key.

## Preview environment

Preview build also evaluates the production-only env validation during Vercel build.  
That means `Preview` needs the same required keys as `Production`, even when the values point at staging resources instead of live ones.

Set these keys in Vercel Preview before relying on preview deploys:

1. `DATABASE_URL`
2. `BASE_URL`
3. `ADMIN_BASIC_USER`
4. `ADMIN_BASIC_PASS`
5. `NEXT_PUBLIC_SUPABASE_URL`
6. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
7. `SUPABASE_SERVICE_ROLE_KEY`
8. `CRON_SECRET`
9. `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY`

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
4. `npm run test`
5. `npm run build`
6. `next start` smoke checks for `/agents`, `/ai`, `/?ai=1`, `/api/agent`, and Basic auth
7. `POST /api/reservations` accepts `Content-Type: application/json` without requiring `X-Requested-With`

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
To print the current local values in that order, run `.\scripts\print-vercel-env.ps1`.

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
4. `/admin/reservations` -> `401` without Basic auth
5. `/api/agent?pretty=1` -> `200`
6. `/llms.txt` -> `200`

Reservation API probe:

```powershell
curl.exe -s -X POST "https://your-domain.example/api/reservations" ^
  -H "Content-Type: application/json" ^
  -d "{}"
```

The probe should return `400` with `code=VALIDATION_ERROR`. It must not fail with `MISSING_REQUEST_HEADER`.

## Human QA after deploy

Confirm these manually in a browser:

1. `/agents`
2. `/booking`
3. `/on-line-store`
4. `/on-line-store/apron?mode=agent&qty=2`
5. `/on-line-store/cart?mode=agent`
6. `/dashboard/orders` prompts for Basic auth
7. `/admin/reservations` prompts for Basic auth

## Rollback

If the deploy is bad:

1. Re-deploy the previous successful production deployment in Vercel
2. Keep the same production env vars unless the failure came from env changes
3. If the failure came from a Prisma migration, restore from database backup instead of editing production tables by hand
