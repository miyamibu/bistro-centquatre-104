# Deployment & infrastructure setup

This repository’s commercial production target is **Netlify Free**. Vercel remains on Hobby only as historical evidence and must not carry Bistro commercial production traffic. `vercel.json` intentionally contains no cron configuration.

## Runtime topology

- Web/API: Netlify Free, Next.js App Router through the Netlify Next.js/OpenNext integration.
- Database/Auth: Supabase PostgreSQL and Supabase Auth.
- Primary scheduler: public-repository GitHub Actions.
  - Notification Outbox: every five minutes.
  - Daily maintenance and LINE reminders: three bounded daily windows.
- Provider failsafe: Netlify scheduled function, once daily, for reservation email, order notification, and LINE reminder lanes.
- Email: Resend in Preview and Production. SendGrid compatibility is local-only because it does not provide the selected native idempotency boundary.

## Required production configuration

Set values in the Netlify **Production** context and keep Preview isolated. Never commit or print secret values.

1. `DATABASE_URL`: transaction pooler URL for the dedicated runtime login.
2. `DIRECT_URL`: session pooler URL for the same dedicated runtime login.
3. `BASE_URL` and `NEXT_PUBLIC_APP_URL`: identical Netlify HTTPS production origin.
4. `PRODUCTION_HOST_PROVIDER=netlify`.
5. Supabase public URL/anon key and server-only service-role key.
6. `STAFF_SESSION_MAX_AGE_SECONDS`.
7. `CRON_SECRET` and `BACKUP_EXPORT_SECRET`.
8. `RATE_LIMIT_HASH_SECRET` and `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY`.
9. Reservation-token and backup-encryption keyrings with active key IDs.
10. `LINE_LINK_TOKEN_PEPPER` even when LINE provider delivery is intentionally disabled.
11. Resend provider key, authorized `EMAIL_FROM`, and `STORE_NOTIFY_EMAIL`.
12. LINE channel/LIFF values only when the integration is enabled and verified.

Production and Preview checks:

```bash
npm run check:release:preview
npm run check:release:production
```

The production runtime PostgreSQL login must inherit `bistro_app_runtime`; it must not be the database owner. `supabase/verify.sql` is the authority for RLS, destructive privilege, FK, policy, and cleanup-function boundaries.

## Release sequence

1. Confirm branch, exact 40-character HEAD, clean status, and PR checks.
2. Run the full local preflight and create all three recovery artifacts: encrypted reservation export/drill; encrypted PostgreSQL dump/disposable PG17 restore; verified Git bundle bound to HEAD.
3. Apply additive Prisma migrations as the owner. Re-run `supabase/verify.sql` as the dedicated runtime role.
4. Deploy the exact candidate to an isolated Netlify Deploy Preview.
5. Run public, admin-boundary, reservation/idempotency/manage/cancel, cron-auth, mobile, desktop, CSP, and accessibility canaries.
6. Exercise rollback on an isolated deploy or restore a prior Netlify deployment and then re-promote the candidate.
7. Require an identified Supabase Auth staff account with `app_metadata.role=ADMIN` or `STAFF` and TOTP AAL2 before authenticated admin canaries.
8. Deploy Production only after Preview, restore, independent audit, and authentication gates pass.
9. Set GitHub repository secrets `PRODUCTION_BASE_URL` and matching `CRON_SECRET`, then run both workflows manually once.
10. Capture at least one real scheduled heartbeat before declaring GO.
11. Align PR head/merge SHA, `origin/main`, CI SHA, deployed SHA, and workspace-bundle provenance.
12. Stop Vercel Hobby commercial traffic only after the Netlify production origin is healthy.

## Scheduler contracts

- Every cron endpoint requires constant-time Bearer authentication and returns `ok: true` only for an accepted run, including an explicitly disabled optional LINE lane.
- Workflows have endpoint deadlines, a global maintenance deadline, bounded pagination, and non-zero failure on partial delivery.
- Netlify’s daily scheduled function invokes all three notification lanes with a ten-second request timeout.
- Durable Outbox rows, claim fencing, provider idempotency, heartbeat records, and ADMIN+AAL2 manual drain are the recovery boundary.

## Rollback

- Application: restore the prior Netlify deploy, verify its commit/fingerprint, then run public and cron-auth smoke tests.
- Database: migrations are expand-only. Do not drop new columns/tables during an incident. Use `docs/recovery/RECOVERY_RUNBOOK.md` before any production write-back decision.
- Scheduler: disable GitHub workflows or remove scheduler secrets only when outbound execution must stop. Do not delete pending Outbox rows.
- Secrets: rotate exposed values, update every consumer, and invalidate the old value. Never place replacement values in Git, logs, screenshots, or chat.

## GO boundary

Local tests, a successful build, a Preview, or an applied migration do not independently prove production readiness. `PRODUCTION_GO_CONFIRMED_FREE_TIER` is permitted only when `docs/release/free-tier-release-evidence.md` has no unresolved internal or external gate.
