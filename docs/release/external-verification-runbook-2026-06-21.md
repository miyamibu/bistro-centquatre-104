# External Verification Runbook - 2026-06-21

## Goal

本番や外部サービスに触る前に、Vercel / LINE / mail / DNS / Pixel 9a の確認項目、証跡、NG条件を固定する。

## Context

- Current release decision is `NO_GO`.
- This runbook is not approval to modify production.
- Secret values, token values, database URLs, customer PII, and real customer LINE/mail addresses must not be recorded.
- Use synthetic test data only.

## Constraints

- Do not run production write actions without explicit approval.
- Do not send real customer LINE or mail messages.
- Do not paste secret values into chat, docs, terminal logs, screenshots, or PR text.
- Use Preview/staging before Production wherever possible.
- Save screenshots without PII.

## Done When

- Each section has a named owner, timestamp, evidence path, result, and residual risk.
- Any NG item keeps release status as `NO_GO`.
- Production deploy is not started from a dirty tree.

## Evidence Folder

Use a private local folder outside Git-tracked release files:

```text
.codex-audit/external-verification-evidence-2026-06-21/
```

Allowed evidence:

- env presence screenshots with values hidden
- Vercel deployment/cron status pages with values hidden
- LINE settings screenshots with tokens hidden
- mail domain verification pages with secrets hidden
- DNS/TLS command output with no customer data
- Pixel 9a screenshots using synthetic test records only

## Vercel

### Checks

| Item | How to verify | Evidence | NG condition |
|---|---|---|---|
| Project | Confirm project is `bistro-centquatre-104` or approved successor | Project settings screenshot with org/project visible only | Wrong project or ambiguous project |
| Production env presence | Vercel dashboard or `vercel env ls production`; values hidden | Key names and environments only | Required key missing or wrong environment |
| Preview env presence | Vercel dashboard or `vercel env ls preview`; values hidden | Key names and environments only | Preview uses production DB/secrets without explicit approval |
| Required runtime keys | `DATABASE_URL`, `DIRECT_URL`, `BASE_URL`, `ADMIN_BASIC_USER`, `ADMIN_BASIC_PASS`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `BACKUP_EXPORT_SECRET`, `RATE_LIMIT_HASH_SECRET`, `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY` | Presence only | Any required key missing |
| LINE keys | `NEXT_PUBLIC_LIFF_BOOKING_ID`, `NEXT_PUBLIC_LIFF_LINK_ID`, `LINE_LOGIN_CHANNEL_ID`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_LINK_TOKEN_PEPPER` | Presence only | Missing when LINE is in launch scope |
| Mail keys | `EMAIL_PROVIDER`, provider API key, `EMAIL_FROM`, `ADMIN_EMAIL` | Presence only | Sender not verified or API key missing |
| Preview/Production separation | Compare env targets without showing values | Checklist signed by operator | Preview points to live production DB unintentionally |
| Cron definitions | Confirm `vercel.json` paths: `/api/crons/cancel-expired-orders`, `/api/crons/delete-old-histories`, `/api/crons/remind`, `/api/crons/process-order-notifications`, `/api/crons/process-reservation-emails` | Vercel cron page screenshot | Missing schedule or wrong path |
| Cron logs | Confirm latest run status, duration, auth outcome, and no overlap | Log excerpt with secrets hidden | 401/500, timeout, overlap, or no recent success |

### Secret-safe commands after approval

```bash
npx vercel env ls production
npx vercel env ls preview
```

Do not use commands that print values. Do not run `vercel env pull` unless separately approved and destination is confirmed.

## LINE

### Provider and channel checks

| Item | Expected | Evidence | NG condition |
|---|---|---|---|
| Provider | Login, LIFF apps, and Messaging API channel are under the same Provider | Console URLs with provider ID visible; tokens hidden | Provider mismatch |
| LINE Login channel | Web app, `openid` and `profile` scopes enabled | Settings screenshot | Missing `openid`; ID token cannot be verified |
| Messaging API channel | Webhook on, official account linked | Settings screenshot | Webhook off when LINE launch is in scope |
| Booking LIFF | Endpoint `/booking`, size Full, scopes `openid profile` | LIFF settings screenshot | Wrong endpoint/size/scopes |
| Link LIFF | Endpoint `/line/link`, size Full, scopes `openid profile` | LIFF settings screenshot | Wrong endpoint/size/scopes |
| Redirect/webhook URL | Production or Preview URL exactly matches environment under test | Settings screenshot | URL points to wrong deployment |
| Webhook verify | Verify returns success against the intended deployment | Console result screenshot | Verify fails |
| Redelivery | Enabled or explicitly accepted as disabled | Settings screenshot | Disabled without owner acceptance |
| Quota/plan | Remaining monthly push quota enough for launch/test | Quota screenshot | Launch would exceed quota |
| Test receipt | Synthetic test account receives expected LINE message | PII-free screenshot | No receipt or wrong content |
| Phone auto-link policy | Disabled by default or stronger ownership verification approved | Owner signoff | Phone hash treated as ownership proof without approval |

### Test data rule

Use a test LINE account and synthetic reservation/order only. Do not use existing customer phone/email/name.

## Mail

| Item | How to verify | Evidence | NG condition |
|---|---|---|---|
| Provider | Confirm selected provider matches `EMAIL_PROVIDER` | Dashboard screenshot | Provider mismatch |
| Sender domain | Domain/address verified | Provider domain page | Unverified sender |
| SPF | DNS record includes provider-approved SPF | DNS checker output | Missing/wrong SPF |
| DKIM | DKIM verified in provider dashboard and DNS | Provider/DNS evidence | Missing/wrong DKIM |
| DMARC | Policy exists and is appropriate for launch | DNS checker output | Missing DMARC without owner acceptance |
| Synthetic send | Send to operator-controlled test mailbox only | Redacted provider log | Customer mail used |
| Receive | Test mailbox receives message and content renders | PII-free screenshot | Not received or broken content |
| Bounce/complaint | Provider logging path identified | Dashboard screenshot | No owner for bounces/complaints |

## DNS / TLS

| Item | Command or check | Expected | NG condition |
|---|---|---|---|
| Production domain | `dig +short <domain>` | Points to approved Vercel target | Wrong target |
| HTTPS | `curl -I https://<domain>/` | `200` or expected redirect | TLS failure |
| HTTP redirect | `curl -I http://<domain>/` | Redirects to HTTPS | Plain HTTP served |
| Certificate | Browser or `openssl s_client` | Valid cert, expected SAN | Expired/wrong cert |
| HSTS | Response headers | Present if approved policy | Missing if required by policy |
| www/non-www | `curl -I` both names | Canonical redirect consistent | Split canonical |
| Canonical BASE_URL | Vercel env presence and app behavior | Same public origin | Env/domain mismatch |

Do not include customer paths or query strings in DNS/TLS evidence.

## Pixel 9a Verification

### Device setup

- Use physical Pixel 9a.
- Test Chrome and LINE in-app browser separately.
- Use synthetic test user/order/reservation only.
- Save screenshots under `.codex-audit/external-verification-evidence-2026-06-21/pixel-9a/`.
- Screenshots must not show real customer names, phones, addresses, emails, tokens, or order references.

### Routes

| Route | Browser | Checks | NG condition |
|---|---|---|---|
| `/booking` | Chrome + LINE in-app browser | LIFF/init fallback, form input, validation, submit guard | Blank, overlap, blocked submit, wrong LINE state |
| `/line/link` | Chrome + LINE in-app browser | token/lookup flow UI, invalid token, already-linked state | Trusts client `lineUserId`; leaks match details |
| `/on-line-store` | Chrome | product list, cart add/remove, payment selection entry | Layout break, price mismatch |
| `/staff` | Chrome | access behavior, no sensitive public data | Unexpected public access |
| `/admin/reservations` | Chrome | Basic auth challenge, mobile table usability | Admin data visible without auth |

### Interaction checklist

- double tap on primary buttons does not duplicate visible actions
- offline/reconnect shows recoverable state
- Japanese IME input fits fields and validation messages
- portrait and landscape do not overlap controls
- 200% zoom equivalent remains usable
- slow network does not expose inconsistent final states
- back/refresh preserves expected idempotent behavior

## Stop Conditions

- Any secret value becomes visible in output or screenshot.
- Any customer PII is used or displayed in evidence.
- A production write/apply/send/deploy step is needed but not separately approved.
- Preview and Production target separation is unclear.
- Pixel 9a evidence cannot be captured without real customer data.
