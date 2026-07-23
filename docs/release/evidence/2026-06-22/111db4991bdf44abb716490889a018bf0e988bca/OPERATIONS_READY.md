# Operations Readiness

Status: `NOT_READY`

## Closed

- Local release gates passed for RC SHA `111db4991bdf44abb716490889a018bf0e988bca`.
- GitHub CI passed for the same RC SHA.
- Vercel project was identified and linked locally.
- Pixel 9a device presence was confirmed.

## Open

- Preview env must be populated with non-production DB, non-production LINE, and non-production mail settings.
- Preview deployment must point to RC SHA `111db4991bdf44abb716490889a018bf0e988bca`.
- Preview smoke must pass for booking, LINE link, order, admin auth, cron, and error states.
- Production env must include `IDEMPOTENCY_HASH_SECRET` and all required launch env names without exposing values.
- Supabase production must be linked, backed up, migrated, and post-checked with read-only RLS/GRANT evidence.
- Production deployment must point to the same RC SHA.
- LINE provider/LIFF/Messaging API/webhook/redelivery/quota/real delivery evidence must be captured.
- Mail SPF/DKIM/DMARC, send, bounce/complaint evidence must be captured.
- Cron/monitoring alert tests must be captured.
- Backup freshness, restore drill, rollback drill, and decision criteria must be captured.
- Pixel 9a Chrome and LINE in-app browser evidence must be captured from the RC deployment.
- Store and legal approval checklist must have owner, timestamp, and evidence path for every item.

## Stop Condition

Do not mark GO until every Open item is closed with evidence for the same RC SHA.
