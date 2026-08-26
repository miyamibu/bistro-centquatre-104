# Nemotron 3 Ultra Free post-fix audit capture

## Assignment identity

- Requested/used model: `Nemotron 3 Ultra Free`
- Provider model ID: `opencode/nemotron-3-ultra-free`
- Session ID: `ses_fc3d15ca8ffeqy86wTmvPhpYrz`
- Target commit: `6cbebe4bbd68479923427ce2a2e692ba4e6cd0a4`
- Detached worktree: `/tmp/bistro-nemotron-post-fix.rdZEGJ`
- Started/completed: `2026-08-26T12:51:22+0900` / `2026-08-26T12:54:32+0900`
- Mode: read-only independent adversarial audit
- Raw final text SHA-256: `b554439f1c3ea3551311aa7d95dec01a9daa136b3b65fef464f2f47a0c8a59af`

The raw final text remains retrievable from the OpenCode session database by session ID. The parent did not replace the named model or rewrite the raw findings.

## Raw verdict

Nemotron returned `REVIEW_STATUS: INCOMPLETE` and `VERDICT: NO_GO`, with 3 P0, 7 P1, 5 P2, and 5 P3 entries. This verdict applies to the fixed target commit above, not to the convergence changes made afterward.

## Parent counter-review and disposition

The parent checked every proposed issue against the target source, tests, configuration, and executed production evidence. A finding is not accepted merely because it was assigned a severity.

| ID | Disposition | Evidence and rationale |
| --- | --- | --- |
| P0-1 | ACCEPTED / FIXED | Production code no longer branches on `VITEST`; route tests mock the scheduling boundary. A regression contract prevents reintroduction. Durable scheduler recovery remains independent of the immediate attempt. |
| P0-2 / P2-4 | REJECTED (security regression) | Supabase AMR entries identify methods and timestamps. Falling back to a refreshed JWT `iat` would restore the exact session-extension bypass the fix prevents. Missing, empty, malformed, or refresh-only AMR therefore remains fail-closed and has an explicit test. |
| P0-3 | ACCEPTED / FIXED | The obsolete Vercel redirect was deleted. Regression checks reject redirects and any `vercel.app` literal in `vercel.json`; release checks independently reject a Vercel production origin. |
| P1-1 | REJECTED (unsafe fallback) | A customer confirmation without its management URL is incomplete and removes the promised self-service path. `BASE_URL` and the reservation idempotency row are mandatory release/data invariants, so this path intentionally fails closed and is surfaced as durable `SKIPPED_MISSING_MANAGEMENT_URL`. |
| P1-2 | REJECTED (non-mutating GET) | Status is a non-mutating ADMIN+AAL2 endpoint with `private, no-store`. A cross-origin image request cannot read the JSON response. The mutating drain endpoint separately enforces origin and requested-with checks. |
| P1-3 | REJECTED (stale notification risk) | When LINE is unconfigured, no reminder claim or sent marker is changed. A later run for the same target date reselects the rows. Advancing a cursor while changing no durable state would not fix provider configuration and sending a stale day-before reminder on another date is intentionally avoided. Production release validation requires LINE configuration. |
| P1-4 | REJECTED (already implemented) | The cited source already parses both values with `new URL()` and checks `url.hostname.endsWith(".vercel.app")`. |
| P1-5 | NO ISSUE IN RAW REPORT | The auditor's own text concluded the immediate/cron separation and retry behavior were correct. It should not have been included in the P1 count. |
| P1-6 | REJECTED (factually incorrect) | `enforceReservationWriteRateLimit` runs and commits before the reservation transaction begins. Unexpected limiter failures return 503 fail-closed. |
| P1-7 / P2-5 | REJECTED (state-machine misread) | `SENT`, `SKIPPED`, and `DEAD_LETTER` rows leave the candidate query permanently. Retry rows receive a future `nextAttemptAt`. Therefore each five-minute call advances naturally without a cursor; a cursor is only an in-invocation optimization. |
| P2-1 | REJECTED (configuration overlooked) | `netlify.toml` pins Node 22, and the offline Netlify SSR/API/function bundle passed with the configured runtime. |
| P2-2 | ACCEPTED / FIXED AT RELEASE GATE | Resend receives its native provider idempotency option. SendGrid provider-side deduplication is not claimed, so Preview/Production release checks now require the existing Resend configuration; SendGrid compatibility remains local-only. |
| P2-3 | REJECTED FOR CURRENT KEY CONTRACT | Backup input is a generated high-entropy encryption key, not a human password, and is length-checked, stored in Keychain, and rotatable by key ID. Replacing the format with a password KDF would require a versioned migration and does not repair a demonstrated weakness in the current random-key contract. The database safety dump independently uses PBKDF2 with 200,000 iterations. |
| P3-1 | REJECTED (intentional telemetry) | `IMMEDIATE` is a deliberate scheduler-kind row so administrators can distinguish immediate attempts from GitHub and provider invocations. It is not used for the 15-minute GitHub heartbeat warning. |
| P3-2 | REJECTED (factually incorrect) | The dump script parses the connection URL into `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, and `PGSSLMODE`. The production encrypted dump and `pg_restore --list` verification passed. |
| P3-3 | REJECTED (unsupported scenario) | The raw report did not show a conflicting transaction path or a leaked error. The export limiter is intentionally fail-closed and the endpoint's tests cover its bounded administrative behavior. |
| P3-4 | NO ISSUE IN RAW REPORT | The deterministic reminder retry key is already used for the cited reminder path; the auditor described the path as correct. |
| P3-5 | DEFERRED OBSERVATION, NOT A DEFECT | The report offered no reproduction of schema cache leakage. Release migration and schema verification complete before traffic; runtime database errors remain sanitized. |

## Convergence changes

- Removed the runtime `VITEST` bypass from the post-response scheduling boundary.
- Mocked that boundary in direct route tests instead of changing production behavior.
- Deleted the old Vercel Hobby redirect.
- Added regressions for the scheduling boundary, redirect absence, and fail-closed missing-AMR behavior.
- Fixed Preview/Production email delivery to Resend's provider-native idempotency contract and made high-frequency Vercel Cron fail even if a future environment incorrectly claims a Pro plan.

## Independent-review boundary

The session must re-review the convergence commit in a fresh detached worktree. Preview, physical-device UI, live scheduler, deployment, rollback, merge, and public production remain separate gates.
