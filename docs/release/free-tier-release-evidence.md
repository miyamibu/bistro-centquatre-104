# Free-tier release evidence

Status as of 2026-08-31: `BLOCKED_EXTERNAL_PROVIDER`.

The detailed current packet is [production-go-execution-2026-08-31.md](evidence/production-go-execution-2026-08-31.md). The [2026-08-27 packet](evidence/production-go-execution-2026-08-27.md) is retained as historical pre-deployment evidence.

Implementation/local evidence, database evidence, provider-plan evidence, Preview evidence, Production evidence, scheduler evidence, delivery evidence, rollback evidence, merge evidence, and public-release evidence are separate gates.

## Current outcome

| Gate | Result | Evidence |
| --- | --- | --- |
| Release code | PASS | PRs #2 and #3 merged; release merge `10372b57e8e1ebc06b456139946cb25f37a0220b` |
| Main CI | PASS | Reservation Hardening `33348454885`; Security Checks `33348454883` |
| Production | PASS | Netlify deploy `6a94dc448e4a2000088368dd`, exact release merge SHA, ready/plugin success |
| Administrator | PASS | intended identity confirmed, ADMIN, verified TOTP, AAL2 protected-page access |
| Scheduler/Outbox | PASS | workflow `33348816911`; empty backlogs; persisted heartbeats |
| Provider failsafe | PASS | Netlify `Run now`: three lanes succeeded, zero failed |
| Rollback | PASS | previous ready deploy restored and checked, then final deploy re-promoted and rechecked |
| Vercel retirement | PASS | Bistro Git integration disconnected; three Bistro aliases removed and return HTTP 404 |
| Reservation export | PASS | fresh; 91/91 encrypted day files verified; AES-256-GCM v2/key ID v1 |
| Restore validation | PASS | 96/96 retained encrypted files decrypted and schema/checksum validated; zero DB writes |
| Workspace bundle | PASS | complete history; release HEAD/SHA-256 provenance match; mode 600 |
| Exact 22-model runtime | BLOCKED_EXTERNAL_PROVIDER | 17 valid runtime responses; five exact models unavailable after bounded retries |

The production runtime is operational. Formal `PRODUCTION_GO_CONFIRMED_FREE_TIER` is not declared because the explicit 22/22 exact-model gate is not satisfied.

## Historical 2026-08-27 pre-deployment index

The sections below preserve the state that existed on 2026-08-27 and are not current release claims.

## Current candidate

- Branch: `agent/remove-menu-course-counts`
- Code HEAD: `ede6861310e6750df64994da1a47bd8683170868`
- `origin/main`: `19334cb0d87c98b4a3999c9abfd17e050503a566`
- PR #2: OPEN and MERGEABLE
- Selected production host: Netlify Free
- Retired production path: Vercel Hobby; no candidate cron configuration

## Passed gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Production safety implementation | PASS_LOCAL | public-mutation hardening, durable Outboxes, bounded retries/cleanup, HMAC audit IPs, fail-closed rate limits, MFA/session checks, management tokens, backup controls |
| Exact-HEAD tests | PASS_LOCAL | 75 files pass, 3 skip; 558 tests pass, 11 safe skips |
| Static/release validation | PASS_LOCAL | typecheck, lint, actionlint, env permissions, destructive scanner, dependency audit, and production build |
| Production DB migrations | PASS_DB | 26 completed migrations and one historical rollback row |
| Preview DB migrations | PASS_DB | isolated DB; 26 completed migrations and one historical rollback row |
| Production schema/RLS/grants | PASS_DB | verification and runtime-role restrictions pass |
| Database recovery | PASS_RESTORE | encrypted dump, restore list, disposable PostgreSQL 17 restore, and count comparison |
| Reservation export | PASS_BACKUP | 91 encrypted files, current freshness, integrity and permissions pass |
| Reservation restore drill | PASS_DRY_RUN | authenticated decrypt and schema-v4 validation; 6 reservations and 1 notification event |
| Netlify account safety | PASS_PROVIDER | Free / 300 credits; no card, auto top-up, or active trial |
| Exact Netlify Preview | PASS_PREVIEW | deploy `6a8f02caf18ed9000875b51a`, correct SHA, plugin success, zero secret-scan matches |
| Booking/API Preview smoke | PASS_PREVIEW | three cold availability calls and 20 sequential monthly calls all HTTP 200; mobile/A11y/auth boundaries pass |
| Supabase pooler compatibility | PASS_PREVIEW | corrected branch-context precedence; 20 sequential Prisma advisory-lock transactions pass |

## Independent audit state

### Ox Alpha Free

- Earlier baseline audit completed and its findings were integrated.
- The current provider catalog no longer serves `opencode/x-preview-f-free`: three exact-model attempts failed with provider `Unexpected server error`.
- State: `MODEL_UNAVAILABLE_CURRENT_CATALOG`.
- No substitute is labeled as Ox Alpha Free.

### Nemotron 3 Ultra Free

- Exact model: `opencode/nemotron-3-ultra-free`
- Broad independent session: `ses_fc18b37d8ffeuPCeGwxL1tfmJp`
- Detached target: `6ed37f3ac0584bba244bd32ca531174823020e41`
- State at this update: running after complete repository coverage; provider is automatically retrying intermittent NVIDIA 502 overload responses
- A focused audit of `6ed37f3..ede6861` follows the broad audit.

## External blockers

| Gate | State | Reason |
| --- | --- | --- |
| Administrator invitation acceptance | BLOCKED_USER_ACTION | invited identity is unconfirmed and has never signed in |
| TOTP/AAL2 enrollment | BLOCKED_USER_ACTION | zero MFA factors |
| ADMIN role provisioning | WAITING_FOR_VERIFIED_IDENTITY | no unknown or unverified identity is elevated |
| Exact final GitHub CI | BLOCKED_EXTERNAL_QUEUE | Security run `32984543569` is stuck before job creation; Reservation Hardening run is absent |
| Netlify Production deploy | NOT_RUN | administrator and exact-CI gates remain open |
| Authenticated admin canary | NOT_RUN | requires invitation acceptance, role, and TOTP |
| Real Resend/LINE canaries | NOT_RUN | Production not published |
| Scheduler/manual drain/heartbeat | NOT_RUN | Production not published and workflow is not on default branch |
| Netlify rollback exercise | NOT_RUN | no successful Production deploy exists |
| Vercel traffic cutover | NOT_RUN | only after Netlify canary and rollback pass |
| PR merge / final SHA alignment | NOT_RUN | all preceding gates must pass |
| Final workspace bundle | WAITING_FINAL_EVIDENCE_COMMIT | current valid bundle predates the final evidence commit |

No production GO claim is permitted while any row above is not PASS.
