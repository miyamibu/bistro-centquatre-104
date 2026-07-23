# Operations readiness

Date: 2026-06-22 JST
RC SHA: `3a460a4067b2d9714e874626bd8563e2a04a63e4`
Status: `NOT_READY`

## Ready Evidence Collected

- Production deployment is `READY`.
- Production smoke passed for the core public pages and availability APIs.
- Production DB migration and read/post checks completed.
- Physical iPhone Safari screenshots were captured for core public flows and admin Basic auth gate.
- Physical Android Pixel 9a Chrome screenshots were captured for core public flows and admin Basic auth gate.

## Not Ready

- Preview was intentionally skipped, so same-SHA Preview validation is not available.
- Preview non-production environment separation is not proven.
- Order notification outbox cron is daily, not near-real-time.
- LINE provider, LIFF, webhook verification, redelivery, push/reminder delivery, and quota evidence are incomplete.
- Mail SPF/DKIM/DMARC plus delivery and bounce/complaint evidence are incomplete.
- Monitoring alert test is incomplete.
- Backup freshness, restore drill, and rollback drill are incomplete.
- Store and legal approval checklist remains incomplete.

## Operational Decision

`Operations: NOT_READY`

This environment can be used for continued controlled validation, but it must not be represented as a fully GO-ready launch until every blocking item above has dated evidence and owner approval.
