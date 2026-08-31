# Recovery runbook

## Recovery sources

Keep these lanes independent. One passing lane never substitutes for another.

1. Reservation export: encrypted daily application records plus manifest/checksums.
2. PostgreSQL safety dump: encrypted PostgreSQL custom archive plus SHA-256 manifest.
3. Workspace bundle: verified Git bundle plus exact HEAD and SHA-256 provenance.
4. Provider state: Netlify deploy history, GitHub workflow history, Supabase managed backups, and provider delivery logs.

Secret material stays in the operator’s secure store. A backup without its retained key is not restorable and must not be reported as a recovery PASS.

## Immediate incident actions

1. Stop mutation or outbound schedulers only if continuing would worsen the incident.
2. Record the public URL, deployed commit/deploy ID, UTC/JST time, failing route, status code, and request ID.
3. Preserve pending Outbox rows and current database state. Do not hard-delete reservations, audit logs, or recovery artifacts.
4. Create a fresh encrypted safety dump when the database remains readable.
5. Prefer application rollback for code regressions; migrations are expand-only and old code must ignore additive schema.

## Application rollback

1. Select the exact prior successful Netlify deploy.
2. Record current and target deploy IDs/commit fingerprints.
3. Restore the prior deploy.
4. Verify `/`, `/booking`, `/robots.txt`, `/sitemap.xml`, unauthenticated admin redirect, availability, and cron 401 boundaries.
5. Re-promote the fixed candidate only after the same checks pass.

A remembered rollback command is not evidence; record the provider result and post-rollback fingerprint.

## Reservation-export restore validation

Use `npm run backup:restore-drill` with the retained backup keyring. This decrypt/schema/checksum validation does not write to a database. Verify file date, key ID, counts, and exact encrypted-file SHA-256.

## PostgreSQL disposable restore drill

The safety dump uses PostgreSQL custom format encrypted with AES-256-CBC/PBKDF2 (200,000 iterations). The drill must:

1. Use PostgreSQL 17 client/server binaries matching Supabase major version.
2. Stream OpenSSL decryption directly into `pg_restore`; never write a plaintext dump at rest.
3. Restore only into a uniquely named disposable local PostgreSQL 17 database.
4. Recreate required Supabase role/schema dependencies (`anon`, `authenticated`, `service_role`, `auth.users`, and referenced non-public trigger functions) before public-schema restore.
5. Reapply production runtime grants because safety dumps intentionally use `--no-privileges`.
6. Run all remaining Prisma migrations.
7. Run `supabase/verify.sql` as `bistro_app_runtime`.
8. Compare major table counts with the source snapshot and confirm migrations did not unexpectedly change rows.
9. Stop the temporary server and delete only its uniquely created temporary directory.

The 2026-08-26 drill restored the encrypted current-state dump to disposable PG17 with no plaintext file, matched all 11 checked table counts, applied all then-current migrations, and passed RLS/runtime-grant verification. That proves the tested artifact and procedure, not a future production write-back.

## Production database recovery

Production write-back is a separate, high-impact operation:

1. Identify whether Supabase managed backup or the encrypted custom dump is authoritative.
2. Restore first to a new isolated database/project whenever possible.
3. Run migration history, `supabase/verify.sql`, row-count, referential-integrity, Auth mapping, and application canaries against the isolated target.
4. Document the cutover target, data-loss window, DNS/origin impact, and rollback target.
5. Only then perform the explicitly approved cutover or write-back.

Do not run `prisma migrate reset`, `db push --force-reset`, broad `DELETE`, or destructive schema rollback against production.

## Workspace recovery

```bash
npm run backup:workspace:status -- --expected-head=<40-character-approved-head>
git bundle verify backups/workspace-snapshots/latest.bundle
git bundle list-heads backups/workspace-snapshots/latest.bundle
```

Clone the bundle to a new sibling directory. Do not overwrite a dirty working tree or transplant `.git` into an unexplained directory.

## Completion criteria

- The selected artifact decrypts and validates.
- The isolated restore passes migration, RLS, runtime-grant, integrity, and application canaries.
- The recovered commit and database snapshot are explicitly identified.
- Outbox and scheduler state are reconciled without duplicate delivery.
- Unverified provider, Auth/role/session, real-delivery, and public-traffic gates remain labeled unverified.

No fixed 60-minute RTO is claimed until a timed end-to-end production-like recovery exercise demonstrates it repeatedly.
