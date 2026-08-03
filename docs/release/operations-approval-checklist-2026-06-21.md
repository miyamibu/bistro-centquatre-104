# Operations Approval Checklist - 2026-06-21

## Goal

店舗運用開始前に、技術確認では代替できない人間の責任者・承認・手順を明確にする。

## Context

The technical production deployment already exists, but the formal operations-ready declaration remains separate. This checklist records human approval and execution evidence independently; a production deploy alone does not close the operational gates.

## Constraints

- Do not write secret values in this document.
- Do not include customer PII in screenshots or notes.
- A checkbox is not valid unless owner, date/time, and evidence path are filled.
- `Approval status` records the owner's decision. `Execution status` records whether the operation, receipt, device check, or independent evidence has actually been completed.
- Any `NOT_RUN`, `NOT_VERIFIED`, `DEFINED_ONLY`, or `PLANNED` execution status keeps operations status as `NOT_READY`.

## Done When

- Every required item has an owner, approval timestamp, and evidence path.
- Approval status and execution status are both explicit for every required item.
- The go-live window and rollback owner are approved.
- Staff have completed a drill using synthetic data.
- Monitoring and manual fallback paths are tested or explicitly accepted.

## Approval Record

| Area | Required decision | Owner | Approved at | Evidence path | Approval status | Execution status |
|---|---|---|---|---|---|---|
| Staff auth owner | `/admin` と `/dashboard` のSupabase Authユーザー、role、TOTP MFA、セッション失効を管理する責任者 | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operational-approval-chat-2026-07-16.md | APPROVED | CONFIRMED |
| Token/key rotation | 予約token鍵とバックアップ鍵は鍵IDを切り替え、旧鍵を有効期間・復旧確認まで保持 | 宮下実歩 | 2026-07-18 20:11 JST | docs/recovery/local-reservation-backup.md | APPROVED | NOT_RUN |
| Emergency revocation | Supabaseユーザーを無効化し、role削除・MFA再登録・セッション失効を15分以内に実施 | 宮下実歩 | 2026-07-18 20:11 JST | docs/production/evidence/20260723T000000Z/operations-decision-plan.md | APPROVED | NOT_RUN |
| Monitoring owner | Primary person watching launch health | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operational-approval-chat-2026-07-16.md | APPROVED | CONFIRMED |
| Alert destination | P0はSTORE_NOTIFY_EMAIL/ADMIN_EMAILへメール後に電話、P1はメール。SMSは使用しない | 宮下実歩 | 2026-07-18 20:11 JST | docs/production/evidence/20260723T000000Z/operations-decision-plan.md | APPROVED | NOT_VERIFIED |
| Incident owner | Person who decides stop/rollback during launch | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operational-approval-chat-2026-07-16.md | APPROVED | CONFIRMED |
| Staff drill date/time | 2026-07-18 19:00-19:30 JSTに予約停止・電話切替・ストア停止・認証失効・通知・ロールバック・アレルギー確認を実施し、8項目すべてPASS | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operations-drill-2026-07-18.md | APPROVED | USER_ATTESTED_PASS |
| Manual phone fallback | 必要項目と重複を電話で確認し管理画面へ登録、復旧後に受付一覧と照合 | 宮下実歩 | 2026-07-18 20:11 JST | docs/production/evidence/20260723T000000Z/operations-decision-plan.md | APPROVED | USER_ATTESTED_PASS |
| Reservation stop method | BusinessDay.isClosedまたは時間帯PRIVATE_BLOCKで停止し、CLOSED=400/PRIVATE_BLOCK=409を確認 | 宮下実歩 | 2026-07-18 20:11 JST | docs/production/evidence/20260723T000000Z/operations-decision-plan.md | APPROVED | DRILL_REPORTED |
| Online store stop method | 専用スイッチは使わず、緊急時はVercel Deployment Protectionと正常デプロイへのRollback/Promoteを使用 | 宮下実歩 | 2026-07-18 20:11 JST | docs/production/evidence/20260723T000000Z/operations-decision-plan.md | APPROVED | DRILL_REPORTED |
| LINE outage procedure | What staff do if LINE push/linking fails | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operational-approval-chat-2026-07-16.md | APPROVED | DRILL_REPORTED |
| Mail outage procedure | What staff do if mail provider fails | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operational-approval-chat-2026-07-16.md | APPROVED | DRILL_REPORTED |
| Backup owner | Who confirms reservation backup freshness | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operations-drill-2026-07-18.md | APPROVED | TARGET_NOT_VERIFIED |
| Restore owner | Who may approve data restore or manual SQL | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operational-approval-chat-2026-07-16.md | APPROVED | NOT_RUN |
| Rollback owner | Who approves rollback and verifies target | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operations-drill-2026-07-18.md | APPROVED | DRILL_REPORTED |
| Legal/privacy approval | Privacy/legal page and data handling approved | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operational-approval-chat-2026-07-16.md | APPROVED | POLICY_ACCEPTED |
| Retention approval | Reservation/order/history retention period approved | 宮下実歩 | 2026-07-18 20:11 JST | docs/release/evidence/operational-approval-chat-2026-07-16.md | APPROVED | POLICY_ACCEPTED |
| Cancellation/no-show approval | 初回公開は料金徴収なし。電話受付、CANCELLED/NOSHOW保存、料金請求は別途実装・承認後 | 宮下実歩 | 2026-07-18 20:11 JST | docs/production/evidence/20260723T000000Z/operations-decision-plan.md | APPROVED | POLICY_ACCEPTED |
| Allergy approval | noteで受付し来店時再確認。厨房責任者が判断し、完全除去を約束せず安全確保不能時は提供しない | 宮下実歩 | 2026-07-18 20:11 JST | docs/production/evidence/20260723T000000Z/operations-decision-plan.md | APPROVED | POLICY_ACCEPTED |
| Store display approval | 店舗情報を正式資料と照合し、宮下実歩と店舗スタッフ1名がPixel 9a/PCで確認 | 宮下実歩 | 2026-07-18 20:11 JST | docs/production/evidence/20260723T000000Z/operations-decision-plan.md | APPROVED | NOT_VERIFIED |
| Go-live window | 2026-07-23 09:00公開、2026-07-22 18:00-2026-07-23 13:00凍結・Rollback確認 | 宮下実歩 | 2026-07-18 20:11 JST | docs/production/evidence/20260723T000000Z/operations-decision-plan.md | APPROVED | PLANNED |

## Staff Drill

Use synthetic data only.

| Drill | Expected result | Owner | Evidence path | Status |
|---|---|---|---|---|
| New reservation from `/booking` | Staff can see and handle booking | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| Admin status change | Status changes are understood and audited | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| Private block create/release | Operator name and audit behavior are understood | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| Order flow | Staff understand bank transfer and in-store payment states | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| LINE link/reminder | Staff know what to tell customers if LINE fails | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| Mail delivery failure | Staff know manual confirmation fallback | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| Backup freshness check | Staff can find latest backup status without reading secrets | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| Rollback simulation | Owner can identify rollback target and stop conditions | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |

## Launch Monitoring

| Signal | Owner | Approved at | Check interval | Evidence | NG threshold | Status |
|---|---|---|---|---|---|---|
| Vercel deployment health | 宮下実歩 | 2026-07-18 20:11 JST | 各デプロイおよび公開時間帯は15分ごと | docs/release/evidence/launch-monitoring-acceptance-2026-07-18.md | READY以外、またはbuild/runtime error | CRITERIA_ACCEPTED_NOT_LIVE_VERIFIED |
| Vercel function errors | 宮下実歩 | 2026-07-18 20:11 JST | 公開時間帯は15分ごと | docs/release/evidence/launch-monitoring-acceptance-2026-07-18.md | 同一routeで10分以内に5xxが2件以上 | CRITERIA_ACCEPTED_NOT_LIVE_VERIFIED |
| Cron success | 宮下実歩 | 2026-07-18 20:11 JST | 各scheduled run後、次回runまで | docs/release/evidence/launch-monitoring-acceptance-2026-07-18.md | missedまたはfailed run | NOT_VERIFIED |
| Reservation backup freshness | 宮下実歩 | 2026-07-18 20:11 JST | 毎日09:00 JST | docs/release/evidence/launch-monitoring-acceptance-2026-07-18.md | 最新成功backupが26時間超 | LOCAL_FRESH_TARGET_NOT_VERIFIED |
| LINE webhook/push | 宮下実歩 | 2026-07-18 20:11 JST | 公開前およびLINE連携テスト後 | docs/release/evidence/launch-monitoring-acceptance-2026-07-18.md | webhook検証失敗、push失敗、またはquota超過 | NOT_VERIFIED |
| Mail delivery | 宮下実歩 | 2026-07-18 20:11 JST | 公開時およびprovider/config変更後 | docs/release/evidence/launch-monitoring-acceptance-2026-07-18.md | 15分以内に合成メール未着 | NOT_VERIFIED |
| DB catalog/RLS drift | 宮下実歩 | 2026-07-18 20:11 JST | 毎日09:00 JSTおよびmigration/権限変更後 | docs/release/evidence/launch-monitoring-acceptance-2026-07-18.md | owner/grant/RLSの予期しない差分 | NOT_VERIFIED |

## Manual Fallback

| Failure | Immediate action | Customer-facing action | Recovery owner | Evidence path | Status |
|---|---|---|---|---|---|
| Site down | Pause booking/store entry points if possible | Accept phone reservations | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| Admin inaccessible | Use phone/paper ledger | Do not promise unverified availability | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| LINE down | Continue reservation without LINE | Explain LINE reminder unavailable | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| Mail down | Manually contact customer | Use approved phone/mail fallback | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| DB issue | Stop write paths and preserve evidence | Phone-only fallback | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |
| Payment/order issue | Pause online store | Manual order handling | 宮下実歩 | docs/release/evidence/operations-drill-2026-07-18.md | CHECKED |

## Stop Conditions

- Owner cannot be named for monitoring, incident, backup, restore, or rollback.
- Staff drill is incomplete.
- Staff Auth role/MFA/session revocation and key rotation drill has not yet been executed.
- Legal/privacy/retention/store-display approval is missing.
- Manual fallback cannot be executed during go-live window.
- Any evidence requires exposing customer PII or secrets.

## Current execution gate summary

Approval is complete by owner attestation, but the following execution gates remain separate and must not be inferred from approval: secret rotation/revocation, production alert delivery, production-target backup provenance, cron success, DB catalog/RLS and effective runtime role, LINE authentication/message receipt, mail receipt, store display co-review, and physical-device UI proof.
