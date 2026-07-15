# Operations Approval Checklist - 2026-06-21

## Goal

店舗運用開始前に、技術確認では代替できない人間の責任者・承認・手順を明確にする。

## Context

The current release state is `NO_GO / NOT_READY`. This checklist is required before any production deploy or operations-ready declaration.

## Constraints

- Do not write secret values in this document.
- Do not include customer PII in screenshots or notes.
- A checkbox is not valid unless owner, date/time, and evidence path are filled.
- Any unchecked required item keeps operations status as `NOT_READY`.

## Done When

- Every required item has an owner and evidence.
- The go-live window and rollback owner are approved.
- Staff have completed a drill using synthetic data.
- Monitoring and manual fallback paths are tested or explicitly accepted.

## Approval Record

| Area | Required decision | Owner | Approved at | Evidence path | Status |
|---|---|---|---|---|---|
| Basic auth owner | Name the person responsible for `/admin` and `/dashboard` Basic auth |  |  |  | OPEN |
| Password rotation | Rotation interval and next rotation date |  |  |  | OPEN |
| Emergency revocation | Who can revoke Basic auth immediately and how |  |  |  | OPEN |
| Monitoring owner | Primary person watching launch health |  |  |  | OPEN |
| Alert destination | Destination for production alerts |  |  |  | OPEN |
| Incident owner | Person who decides stop/rollback during launch |  |  |  | OPEN |
| Staff drill date/time | Date/time for staff practice before launch |  |  |  | OPEN |
| Manual phone fallback | How reservations are accepted if site is down |  |  |  | OPEN |
| Reservation stop method | How public booking is paused |  |  |  | OPEN |
| Online store stop method | How online store/order flow is paused |  |  |  | OPEN |
| LINE outage procedure | What staff do if LINE push/linking fails |  |  |  | OPEN |
| Mail outage procedure | What staff do if mail provider fails |  |  |  | OPEN |
| Backup owner | Who confirms reservation backup freshness |  |  |  | OPEN |
| Restore owner | Who may approve data restore or manual SQL |  |  |  | OPEN |
| Rollback owner | Who approves rollback and verifies target |  |  |  | OPEN |
| Legal/privacy approval | Privacy/legal page and data handling approved |  |  |  | OPEN |
| Retention approval | Reservation/order/history retention period approved |  |  |  | OPEN |
| Cancellation/no-show approval | Store policy text and admin handling approved |  |  |  | OPEN |
| Allergy approval | Allergy/note handling and staff responsibility approved |  |  |  | OPEN |
| Store display approval | Store-facing wording, phone, mail, menu, prices approved |  |  |  | OPEN |
| Go-live window | Date/time, owner, rollback window, no-service conflict checked |  |  |  | OPEN |

## Staff Drill

Use synthetic data only.

| Drill | Expected result | Owner | Evidence path | Status |
|---|---|---|---|---|
| New reservation from `/booking` | Staff can see and handle booking |  |  | OPEN |
| Admin status change | Status changes are understood and audited |  |  | OPEN |
| Private block create/release | Operator name and audit behavior are understood |  |  | OPEN |
| Order flow | Staff understand bank transfer and in-store payment states |  |  | OPEN |
| LINE link/reminder | Staff know what to tell customers if LINE fails |  |  | OPEN |
| Mail delivery failure | Staff know manual confirmation fallback |  |  | OPEN |
| Backup freshness check | Staff can find latest backup status without reading secrets |  |  | OPEN |
| Rollback simulation | Owner can identify rollback target and stop conditions |  |  | OPEN |

## Launch Monitoring

| Signal | Owner | Check interval | Evidence | NG threshold |
|---|---|---|---|---|
| Vercel deployment health |  |  |  | build/runtime error |
| Vercel function errors |  |  |  | repeated 5xx |
| Cron success |  |  |  | missed or failed run |
| Reservation backup freshness |  |  |  | older than approved threshold |
| LINE webhook/push |  |  |  | webhook verify fails or push quota exceeded |
| Mail delivery |  |  |  | synthetic mail not delivered |
| DB catalog/RLS drift |  |  |  | unexpected owner/grants/RLS state |

## Manual Fallback

| Failure | Immediate action | Customer-facing action | Recovery owner | Status |
|---|---|---|---|---|
| Site down | Pause booking/store entry points if possible | Accept phone reservations |  | OPEN |
| Admin inaccessible | Use phone/paper ledger | Do not promise unverified availability |  | OPEN |
| LINE down | Continue reservation without LINE | Explain LINE reminder unavailable |  | OPEN |
| Mail down | Manually contact customer | Use approved phone/mail fallback |  | OPEN |
| DB issue | Stop write paths and preserve evidence | Phone-only fallback |  | OPEN |
| Payment/order issue | Pause online store | Manual order handling |  | OPEN |

## Stop Conditions

- Owner cannot be named for monitoring, incident, backup, restore, or rollback.
- Staff drill is incomplete.
- Basic auth rotation/revocation is undefined.
- Legal/privacy/retention/store-display approval is missing.
- Manual fallback cannot be executed during go-live window.
- Any evidence requires exposing customer PII or secrets.
