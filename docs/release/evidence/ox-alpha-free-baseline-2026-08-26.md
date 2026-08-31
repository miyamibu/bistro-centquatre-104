# Ox Alpha Free baseline audit capture

## Assignment identity

- Requested/used model: `Ox Alpha Free`
- Provider model ID: `opencode/x-preview-f-free`
- Session ID: `ses_fc427c53cffeTZY1FZdyVw9XlR`
- Target HEAD: `3da8e140ef3b1d5abd496cdcffbd59b8a16d69ce`
- Started/completed: `2026-08-26T11:30:10+0900` / `2026-08-26T11:32:13+0900`
- Mode: read-only baseline audit
- Raw final text SHA-256: `38e0b9de817f645c4bec37c0d4a3e58baecccb040f5718dc069a72c7385a0bed`

The raw final text remains retrievable from the OpenCode session database by session ID. Its original line references are intentionally not rewritten after fixes.

## Raw verdict and finding index

The auditor returned `VERDICT: NO-GO` and independently confirmed all seven GitHub comments on the starting HEAD:

1. P1: reminders stopped after one batch; no caller followed `nextCursor`.
2. P1: staff TTL used refreshed access-token `iat`, not original login time.
3. P1: backups omitted management-token and reservation-idempotency state.
4. P2: email was unconditionally required despite verified LINE.
5. P2: encrypted-file SHA omitted the newline written to disk.
6. P1: rejected reservation transactions rolled back rate-limit events.
7. P2: configurable cutoff conflicted with fixed `24h` policy naming.

Release-level blockers were Vercel Hobby five-minute cron incompatibility, absent GitHub retry, absent immediate/manual/heartbeat operations, no proven commercial free host, a failed backup lane, and incomplete scheduler rollback evidence.

## Parent integration disposition

| Baseline finding | Candidate disposition |
| --- | --- |
| reminder cursor | Daily workflow follows up to four 100-row pages and fails if not converged |
| session TTL | Original non-refresh AMR timestamp enforced in middleware/server auth |
| backup omissions/hash | Schema v4 adds both models; SHA covers exact file bytes |
| email UX | Required only without verified LINE |
| rate-limit rollback | Separate committed rate-limit transaction; unknown errors fail closed |
| cancellation mismatch | Fixed 24-hour policy; configurable env removed |
| Vercel/GitHub scheduler | Vercel crons removed; bounded public workflows added |
| immediate/manual/heartbeat | Post-response attempts, ADMIN+AAL2 drain/audit, 15-minute warning added |
| free host | Netlify selected from current policy; offline build passes; authenticated Preview blocked |
| backup lane | Keyrings created; production export and real-data drill pass |
| rollback | Code/DB/scheduler/Vercel boundaries documented; provider exercise remains a gate |

## Independent-review boundary

This capture does not claim the fixes are correct. Nemotron 3 Ultra Free must inspect a detached worktree at a fixed post-fix commit independently.
