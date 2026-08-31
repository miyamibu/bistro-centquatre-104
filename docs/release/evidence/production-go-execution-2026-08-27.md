# Production GO execution evidence — 2026-08-27

> Historical pre-deployment packet. Superseded by [production-go-execution-2026-08-31.md](production-go-execution-2026-08-31.md). The states below describe 2026-08-27 and must not be treated as current production status.

## Decision

- Current decision: `NO_GO_EXTERNAL_AUTH_AND_CI`
- Production traffic: not published on Netlify
- Public cutover: not performed
- Reason: the configured administrator has not accepted the Supabase invitation or enrolled TOTP, and exact-HEAD GitHub Actions has not produced completed jobs

Local, database, Preview, Production, scheduler, delivery, rollback, merge, and public-traffic evidence are separate gates. A PASS in one lane does not upgrade another lane.

## Candidate identity

- Canonical repository: `/Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation`
- Branch: `agent/remove-menu-course-counts`
- Candidate code HEAD: `ede6861310e6750df64994da1a47bd8683170868`
- `origin/main`: `19334cb0d87c98b4a3999c9abfd17e050503a566`
- Pull request: #2, OPEN and MERGEABLE
- Working tree before this evidence update: clean

## Exact-HEAD local verification

- Unit/static tests: 75 files passed, 3 skipped; 558 tests passed, 11 explicitly safe-skipped
- TypeScript typecheck: PASS
- ESLint: PASS
- actionlint: PASS
- Environment permission check: PASS; local env mode 600 and untracked
- Destructive-reservation scanner: PASS; 327 files scanned, one reviewed allowlist entry
- Production dependency audit: PASS; zero vulnerabilities
- Next.js production build: PASS; 32 static pages generated

## Netlify Free account and Preview

- Authenticated account API: plan `Free` / `credit-free`
- Included monthly credits: 300
- Stripe payment method: absent
- Auto top-up: disabled
- Active Pro/Enterprise trial: false
- Site: `bistro-centquatre-104`
- Exact Preview deploy ID: `6a8f02caf18ed9000875b51a`
- Deploy state/context: `ready` / `deploy-preview`
- Commit ref: `ede6861310e6750df64994da1a47bd8683170868`
- Plugin state: `success`
- Secret scan: 2,329 files; zero standard or enhanced matches
- Runtime: Node.js 22; Next.js server handler, scheduled failsafe function, and Edge middleware present
- Permalink: <https://6a8f02caf18ed9000875b51a--bistro-centquatre-104.netlify.app>
- PR alias: <https://deploy-preview-2--bistro-centquatre-104.netlify.app>

### Preview runtime checks

- Cold mobile booking load settled in 15,956 ms
- Daily lunch, monthly lunch, and monthly dinner availability: all HTTP 200
- Sequential monthly availability stress: 20/20 HTTP 200
- Client timeout increased from 10 to 20 seconds to tolerate Free-tier cold start plus initial transaction-pooler connection
- 390 px viewport: no horizontal overflow
- Required labels: both surname and given-name inputs have explicit labels
- Menu pagination controls: four controls at 44 x 44 px
- Console errors and failed requests after settlement: none
- Screenshot: `/Users/mimac/.local/state/bistro-production-go-free-tier/evidence/preview-mobile-ede6861.png`
- Screenshot SHA-256: `40cb1c90793d0b00217389e6cb6cddceb4cb913123190249af1741bb733a7b24`
- Cron routes and admin Outbox API without authorization: HTTP 401 with private/no-store policy
- Admin reservations page without authorization: HTTP 307 to login
- Function error/fatal log query after checks: empty

## Database and migration evidence

- Production: 26 completed Prisma migrations, one historical rolled-back row
- Isolated Preview: 26 completed Prisma migrations, one historical rolled-back row
- Latest completed migration: `20260826140000_ephemeral_security_cleanup_and_audit_ip_minimization`
- Production and Preview runtime roles use isolated credentials
- Supabase transaction pooler URLs are release-gated to `pgbouncer=true&connection_limit=1`
- `DIRECT_URL` is release-gated away from transaction-pooler port 6543
- Exact Preview runtime role: 20 sequential advisory-lock transactions PASS
- Production schema/RLS/runtime-grant verification: PASS

## Backup evidence

### Reservation export

- Pulled at: `2026-08-26T15:34:31.190Z`
- Status at check: `FRESH` (0.01 hours)
- Coverage: 2026-07-28 through 2026-10-26
- Encrypted daily files: 91
- Permissions: directory 700; files and run metadata 600
- Integrity: PASS for all 91 files
- Totals: 54 reservations, 13 business days, 3 private-block audits, 1 status audit, 10 LINE-link tokens, and 5 notification events

### Restore drill

- File: `backups/reservation-daily-backups/days/2026-08-16.json.enc`
- Encrypted SHA-256: `aa48df6dd7e8d0ad17a15a5cf08d72a8eebe93c419d9cb2a1334a8aa1f54815e`
- AES-256-GCM decrypt/authentication and schema-v4 validation: PASS
- Payload: 6 reservations and 1 notification event
- Database writes: not supported by the drill and not performed

### Production safety dump

- File: `backups/database-safety-dumps/production-pre-migration-2026-08-26T13-42-19-112Z.dump.enc`
- Encrypted bytes: 294,992
- SHA-256: `9f793dc91071e730ae2cbd72e1deb1fc75e4b8745840019af2aabc28744f5e01`
- `pg_restore --list`: PASS, 414 objects
- Full disposable PostgreSQL 17 restore and table-count comparison: PASS
- Plaintext dump persisted at rest: no

### Workspace bundle

- Latest pre-evidence bundle is valid but binds `a65ec6e5c5eb655e8084a155f9d1f4de83cedf71`
- An exact final-HEAD bundle must be generated after independent-audit evidence is committed

## Independent review

### Ox Alpha Free

- Baseline model ID: `opencode/x-preview-f-free`
- Earlier baseline session completed and its findings were integrated
- Current-catalog exact-model retry: three independent starts returned provider `Unexpected server error`
- Current exact-model state: `MODEL_UNAVAILABLE_CURRENT_CATALOG`
- No substitute model is represented as Ox Alpha Free

### Nemotron 3 Ultra Free

- Model ID: `opencode/nemotron-3-ultra-free`
- Session: `ses_fc18b37d8ffeuPCeGwxL1tfmJp`
- Detached target: `6ed37f3ac0584bba244bd32ca531174823020e41`
- Mode: independent read-only adversarial audit
- Current state at document creation: running; final text not yet captured
- A focused post-diff audit of `6ed37f3..ede6861` remains required after this broad audit completes

## GitHub evidence

- Exact `a65ec6e` Reservation Hardening run `32983578413`: PASS
- Exact `a65ec6e` Security Checks run `32983578425`: PASS
- Exact `ede6861` Security Checks run `32984543569`: stuck at `queued` before job creation
- Exact `ede6861` Reservation Hardening run: not created
- Repository Actions permission: enabled; all actions allowed
- GitHub status page at verification time: Actions operational
- Cancel attempt reports the stuck run as completed while the read API reports queued; rerun reports it is already running
- This is external queue/control-plane evidence, not a code-test failure

## Administrator enrollment gate

The configured administrator identity exists only as an unaccepted Supabase invitation:

- target user exists: yes
- invitation present: yes
- email confirmed: no
- first sign-in: no
- application role assigned: no
- TOTP factors: zero

No unknown existing user was modified. Role assignment is intentionally deferred until the invited person accepts the invitation and enrolls TOTP.

## Remaining production gates

| Gate | State |
| --- | --- |
| Administrator invitation acceptance and password setup | BLOCKED_USER_ACTION |
| TOTP enrollment and AAL2 login | BLOCKED_USER_ACTION |
| ADMIN role provisioning | WAITING_FOR_VERIFIED_IDENTITY |
| Exact final GitHub CI | BLOCKED_EXTERNAL_QUEUE |
| Netlify Production deploy | NOT_RUN |
| Authenticated admin canary | NOT_RUN |
| Real Resend/LINE non-customer delivery canaries | NOT_RUN |
| Production scheduler/manual drain and heartbeat | NOT_RUN |
| Netlify rollback exercise | NOT_RUN |
| Vercel commercial traffic retirement | NOT_RUN |
| PR merge and public SHA alignment | NOT_RUN |

Production GO must not be declared until every remaining row is PASS.
