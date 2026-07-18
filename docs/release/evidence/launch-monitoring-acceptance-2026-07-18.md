# Launch monitoring acceptance - 2026-07-18

- Approver / owner: 宮下実歩
- Production alert destination: Approved operator mailbox; the exact address is kept in the production environment and is not recorded here.
- Approved at: 2026-07-18 20:11 JST.
- Approval source: User approval in the Codex conversation.
- Secret values and customer PII: Not recorded.

The following monitoring values are the approved operating defaults:

| Signal | Check interval | NG threshold |
|---|---|---|
| Vercel deployment health | Each deployment and every 15 minutes during the go-live window | Deployment is not READY or a build/runtime error occurs |
| Vercel function errors | Every 15 minutes during the go-live window | 2 or more 5xx responses for the same route within 10 minutes |
| Cron success | After every scheduled run, before the next scheduled run | Any missed or failed run |
| Reservation backup freshness | Daily at 09:00 JST | Latest successful backup is older than 26 hours |
| LINE webhook/push | Before launch and after each LINE integration test | Webhook verification fails, push fails, or quota is exceeded |
| Mail delivery | Synthetic test at launch and after provider/configuration changes | Test message is not received within 15 minutes |
| DB catalog/RLS drift | Daily at 09:00 JST and after migration or permission changes | Unexpected owner, grant, or RLS state |

## Limitation

This record documents accepted monitoring criteria. It is not a claim that every future monitoring interval has already elapsed successfully. The 26-hour backup threshold is also the default used by `scripts/check-reservation-backup-freshness.ts` after this reconciliation.
