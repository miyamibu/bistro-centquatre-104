# Free-tier release evidence

Status as of 2026-08-26: `PRE_DEPLOY_BLOCKED_USER_INTERACTION`.

Implementation/local evidence, provider evidence, Preview evidence, Production evidence, scheduled-run evidence, and public-release evidence are separate gates.

## Starting snapshot

- Branch: `agent/remove-menu-course-counts`
- Starting HEAD: `3da8e140ef3b1d5abd496cdcffbd59b8a16d69ce`
- Starting `origin/main`: `19334cb0d87c98b4a3999c9abfd17e050503a566`
- PR #2: OPEN, mergeable; old Vercel check failed
- Starting working tree: clean
- Vercel project: Hobby; production SHA older than candidate

## Independent baseline audit

- Model: `opencode/x-preview-f-free` (Ox Alpha Free)
- Session: `ses_fc427c53cffeTZY1FZdyVw9XlR`
- Scope: starting HEAD; read-only; no secret/production access
- Started/completed: `2026-08-26T11:30:10+0900` / `2026-08-26T11:32:13+0900`
- Raw final text SHA-256: `38e0b9de817f645c4bec37c0d4a3e58baecccb040f5718dc069a72c7385a0bed`
- Verdict: `NO-GO`
- Result: all seven GitHub comments were valid on the starting HEAD; host/scheduler/backup operations also blocked GO.
- Boundary: this is not a post-fix audit. Nemotron 3 Ultra Free must independently review a detached committed candidate.

## Implemented and locally verified

| Gate | Result | Evidence |
| --- | --- | --- |
| Seven review findings | PASS_LOCAL | cursor workflow; AMR login timestamp; backup v4; conditional email; exact-file hash; separated fail-closed rate limit; fixed 24-hour policy |
| Vercel Hobby cron removal | PASS_LOCAL | `vercel.json` has no `crons`; regression/actionlint pass |
| Durable immediate attempt | PASS_LOCAL | reservation/order `after()` execution starts only after durable commit; bounded tests pass |
| GitHub retry/maintenance | PASS_LOCAL | standard runner, no checkout/cache/artifact, bounded requests, cursor following; actionlint pass |
| Netlify daily failsafe | PASS_OFFLINE | bounded two-lane scheduled function; offline Netlify bundle pass |
| Manual drain/heartbeat | PASS_LOCAL | ADMIN+AAL2, max 20, dry-run/confirm, audit, no business PII response, 15-minute warning; tests pass |
| Keyrings | PASS_LOCAL_OPERATOR | Keychain entries created; values never printed; legacy compatibility tests pass |
| Production migration | PASS_DB | 23 Prisma migrations and Supabase SQL/RLS applied; `supabase/verify.sql` pass |
| Runtime DB hardening | PASS_DB | no protected runtime DELETE/TRUNCATE or runtime DELETE policy; RLS/FKs/functions pass |
| Dependency audit | PASS_LOCAL | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities |
| Unit/static suite | PASS_LOCAL | 72 files pass, 3 skip; 527 tests pass, 11 safe skips; lint/typecheck pass |
| Local DB suite | PASS_WITH_AUTH_EXCLUSION | 7 tests pass; 4 staff-MFA-cookie cases explicitly skipped; dedicated `bistro_test` only |
| Next build | PASS_LOCAL | production build exits 0 |
| Netlify compatibility | PASS_OFFLINE | SSR/API, Edge Middleware, and scheduled function bundle |
| Mobile booking | PASS_LOCAL_BROWSER | 390x844; no horizontal overflow; production availability loaded; no booking console error |
| Unauthenticated admin boundary | PASS_LOCAL_BROWSER | status API 401 + `private, no-store`; page redirects to login |

The local production build intentionally omitted public Supabase build variables, so `/admin/login` could not render there. Authenticated login UI remains a real Preview gate, not a local PASS.

## Backup evidence

### Reservation export and restore

- Export: PASS, schema v4, 91 encrypted daily files, directory 700/files 600, freshness/integrity PASS
- Counts: 54 reservations, 13 business days, 3 private-block audits, 1 status audit, 10 line-link tokens, 5 notification events, 0 management tokens, 0 idempotency records
- Real-data restore day: `2026-08-16`, 6 reservations and 1 notification event, PASS
- Exact encrypted-file SHA-256: `aa4902643187a80261a12c5539829d98c66e66b92fc9284454b1dde74a7b342a`

### Production pre-migration database dump

- File: `backups/database-safety-dumps/production-pre-migration-2026-08-26T03-03-32-247Z.dump.enc`
- Encrypted bytes/SHA-256: 221376 / `31b1e00010a0b1109192b805809a68c628619455e82b8fb6268388633a33b704`
- PostgreSQL 17 custom dump restore-list: 288 objects, PASS
- No plaintext dump was written at rest.

### Workspace bundle

- Pre-change bundle: PASS; expected HEAD `3da8e140ef3b1d5abd496cdcffbd59b8a16d69ce`
- File: `backups/workspace-snapshots/workspace-2026-08-26T02-11-56-215Z.bundle`
- SHA-256: `e8e5096d4b93790bee69008a44dce1a6c4033ea80f9e8d3f3674dec04576420c`
- A fresh commit-bound bundle remains required after the post-fix candidate commit.

## External gates not yet satisfied

| Gate | State | Reason |
| --- | --- | --- |
| Netlify login/Free plan | BLOCKED_USER_INTERACTION | CLI is unauthenticated; login/account/terms are user-side |
| Netlify Preview and rollback | NOT_RUN | no authenticated site/environment |
| Production deploy/URL/canary | NOT_RUN | Preview gate not passed |
| GitHub `PRODUCTION_BASE_URL` | NOT_SET | production URL does not exist |
| Manual/scheduled scheduler run | NOT_RUN | workflows are not on default branch and no live URL exists |
| Account plan/usage screens | UNVERIFIED | Netlify/Supabase/Resend/LINE authenticated UI required |
| Vercel traffic stop/alias | NOT_RUN | final target URL/provider controls required |
| Nemotron post-fix audit | PENDING | requires fixed committed worktree |
| PR merge/SHA alignment | NOT_RUN | preceding gates must pass |

No production GO claim is permitted while any row above is not PASS.
