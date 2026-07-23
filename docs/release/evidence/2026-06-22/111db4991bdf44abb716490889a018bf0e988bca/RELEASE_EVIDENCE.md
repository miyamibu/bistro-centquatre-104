# Release Evidence

RC SHA: `111db4991bdf44abb716490889a018bf0e988bca`
Branch: `release/go-readiness-20260622`
PR: https://github.com/miyamibu/bistro-centquatre-104/pull/1

## Completed

- Source-only release branch pushed to GitHub.
- Draft PR created.
- GitHub Actions `Reservation Hardening CI` green on run `27921140923`.
- Local gates saved in `local/`:
  - `git-diff-check.log`
  - `npm-run-lint.log`
  - `npm-run-typecheck.log`
  - `npm-run-test.log`
  - `npm-run-test-db.log`
  - `npm-run-build.log`
  - `npm-run-check-release.log`
  - `npm-run-security-env.log`
  - `npm-run-security-destructive-reservations.log`
  - `npm-audit-high.log`
  - `npx-prisma-validate.log`

## External Findings

- Vercel project `miyamibus-projects/bistro-centquatre-104` is linked locally.
- Vercel Preview env returned no variables.
- Vercel Production env presence was listed without values.
- Current production alias is Ready, but it points to an older production deployment created on 2026-06-19, not this RC SHA.
- Production URL returned HTTP 200 with HSTS, CSP, X-Content-Type-Options, X-Frame-Options, Permissions-Policy, and Referrer-Policy headers.
- TLS certificate for `*.vercel.app` is valid from 2026-04-28 to 2026-07-27.
- Supabase CLI can see project `french-restaurant`, but the checkout is not linked.
- ADB detected `Pixel 9a` on Android 16, but RC device verification was not run.

## Verdict

`NO_GO / NOT_READY` until Preview env, Preview deploy, production env, production migration, production deploy, external operations, device evidence, and approvals are complete for the same RC SHA.
