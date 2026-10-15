# Reservation email Worker cutover

`RESERVATION_EMAIL_LEGACY_SENDER_PAUSED` is a strict optional boolean, default `false`. Enable it during the reviewed final cutover before independent delivery. Reservation enqueue continues in the same DB; while paused, cron (Netlify/GitHub/failsafe), immediate callbacks and admin drain cannot claim or send through the legacy processors. Orders and LINE retain their existing processing.

Paused responses report `paused: true`, `dispatchExecuted: false`, zero attempted sends, and the actual database backlog. They do not prove Worker delivery or an empty queue. Legacy scheduler and immediate success heartbeats are not advanced while paused. Backlog includes legacy due rows, all Worker-owned statuses, and any non-null `dispatchUnknownAt` regardless of status, including SENT rows requiring reconciliation; it is not a Worker health check.

Required order:

1. Apply only the separately reviewed additive DB expansion for the five Worker enum values, nullable `dispatchUnknownAt`, and required index; do not introduce the ledger or guards yet.
2. Publish this application with the flag `false`. This Prisma schema is incompatible with the pre-expansion DB even while the flag is `false`: ordinary Prisma queries may select the new column.
3. Complete production connectivity, monitoring, Worker-role readiness and other independent prerequisites while legacy dispatch continues. Do not start a prolonged pause while waiting for readiness work.
4. At the reviewed final cutover, set the flag `true`, drain already executing legacy requests to quiescence, and verify the old sender has stopped. Keep new intents queued; a paused endpoint does not send or drain them.
5. Within this final dispatch interruption, introduce the separately reviewed ledger/reset guards and complete the required 19-source backup capture and verification.
6. Run the reviewed canary and activate independent delivery only after the required checks pass. Monitor backlog and reconciliation state. Normal dispatch is interrupted from the final pause until independent delivery is enabled.

The 19-source implementation has been validated separately; the actual production 19-source capture remains incomplete and is not established by this application patch. Do not treat the ordering above as evidence that those prerequisites have passed or that production activation is ready.

Worker-owned/unknown rows cannot be reset by customer-email resend, including when rolling back the flag. Never return uncertain rows to PENDING to recover the legacy sender. A flag rollback requires a separate check that the Worker is disabled and its claims are quiescent; the flag alone does not fence already executing old deployments.

This local patch does not enable the flag, deploy, migrate, capture a production backup, or send mail.
