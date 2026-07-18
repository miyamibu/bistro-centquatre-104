# Operations document reconciliation - 2026-07-18

## Purpose

Reconcile the approval checklist, operating plan, monitoring criteria, and execution evidence without treating approval as proof of an external operation.

## Decisions

- Owner: 宮下実歩.
- All listed operational decisions were reconfirmed by the owner at 2026-07-18 20:11 JST.
- Staff Drill and Manual Fallback are recorded as `USER_ATTESTED_PASS` because the owner reported the 2026-07-18 19:00-19:30 JST synthetic drill as passing.
- The old 2026-07-21 “実施前” Staff Drill text was superseded by the 2026-07-18 execution report.
- The accepted reservation-backup freshness threshold is 26 hours, and the default in `scripts/check-reservation-backup-freshness.ts` is aligned to 26 hours.
- The public production deployment and formal operations-ready decision are separate states.

## Not implied by this reconciliation

This document does not prove secret rotation or revocation, production alert delivery, production-target backup provenance, cron success, DB effective-role permissions, LINE authentication/message receipt, email receipt, store-display co-review, or physical-device UI proof. Those gates require their own current evidence.
