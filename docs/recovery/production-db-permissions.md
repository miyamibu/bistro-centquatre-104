# Production DB Permission Hardening

## Goal

本番運用中の予約本体、予約監査、通知台帳、LINE連携、日誌、rate-limit記録を、アプリ実行ユーザーや誤操作からhard deleteされにくい最小権限構成にする。

## Context

- `bistro-reservation` は予約受付だけでなく、貸切、営業日、監査、バックアップ/復旧も含む業務システムです。
- 2026-04-21 の復旧記録では、`DELETE FROM "Reservation"` の痕跡を含むデータ整合性問題が記録されています。
- アプリ側ガードだけでなく、本番DB権限でも `DELETE` / `TRUNCATE` を外して多層防御にします。

## Constraints

- この文書の SQL は例です。Codex は実行しません。
- 適用前に必ず DB 管理者または運用責任者が確認してください。
- migration 実行ユーザーと application runtime ユーザーは分離してください。

## Done when

- runtimeユーザーは、各テーブルの実処理に必要な `SELECT` / `INSERT` / `UPDATE` だけを持つ。
- runtimeユーザーは、下記の保護対象14テーブルへの `DELETE` / `TRUNCATE` を持たない。
- 追記型の監査・rate-limitテーブルは `UPDATE` も持たない。
- rollback 手順と確認クエリが用意されている。

## Recommended role split

1. `bistro_app_runtime`
   - 本番アプリ用
   - 必要権限だけをテーブル単位で付与する
   - 下記保護対象への `DELETE`, `TRUNCATE` は付与しない
2. `bistro_migration`
   - Prisma migration や管理者作業専用
   - スキーマ変更時だけ限定利用
   - 通常アプリ実行では使わない

## Example SQL

以下はPostgreSQLの一例です。`bistro_app_runtime` が作成済みであることを先に確認し、実環境に合わせてDB管理者が調整してください。

| テーブル | runtimeの最小権限 | 理由 |
|---|---|---|
| `Reservation` | `SELECT`, `INSERT`, `UPDATE` | 予約作成とstatus更新 |
| `BusinessDay` | `SELECT`, `INSERT`, `UPDATE` | 営業日・休業日管理 |
| `PrivateBlockAuditLog` | `SELECT`, `INSERT` | 追記型の貸切監査 |
| `ReservationStatusAuditLog` | `SELECT`, `INSERT` | 追記型のstatus監査 |
| `ReservationEmailOutbox` | `SELECT`, `INSERT`, `UPDATE` | enqueue、claim、再試行、送信完了 |
| `ReservationIdempotency` | `SELECT`, `INSERT`, `UPDATE` | 同一keyのclaimと保存済みresponse再生 |
| `ReservationLineLinkToken` | `SELECT`, `INSERT`, `UPDATE` | LINE token発行と使用済み更新 |
| `ReservationManagementToken` | `SELECT`, `INSERT`, `UPDATE` | 顧客予約管理token発行と失効 |
| `NotificationEvent` | `SELECT`, `INSERT`, `UPDATE` | 通知claimと結果更新 |
| `LineWebhookInbox` | `SELECT`, `INSERT`, `UPDATE` | Webhook eventの保存、claim、再試行結果更新 |
| `ReservationRateLimitEvent` | `SELECT`, `INSERT` | rate-limit試行の追記と集計 |
| `LineFriend` | `SELECT`, `INSERT`, `UPDATE` | LINE友だち状態の更新 |
| `LineCustomerLink` | `SELECT`, `INSERT`, `UPDATE` | 同意済みLINE顧客リンクの更新 |
| `DailyJournalEntry` | `SELECT`, `INSERT`, `UPDATE` | 日誌の作成・編集・公開 |

```sql
SELECT rolname
FROM pg_roles
WHERE rolname = 'bistro_app_runtime';

REVOKE DELETE, TRUNCATE
ON TABLE
  "Reservation",
  "BusinessDay",
  "PrivateBlockAuditLog",
  "ReservationStatusAuditLog",
  "ReservationEmailOutbox",
  "ReservationIdempotency",
  "ReservationLineLinkToken",
  "ReservationManagementToken",
  "NotificationEvent",
  "LineWebhookInbox",
  "ReservationRateLimitEvent",
  "LineFriend",
  "LineCustomerLink",
  "DailyJournalEntry"
FROM bistro_app_runtime;

GRANT SELECT, INSERT, UPDATE
ON TABLE
  "Reservation",
  "BusinessDay",
  "ReservationEmailOutbox",
  "ReservationIdempotency",
  "ReservationLineLinkToken",
  "ReservationManagementToken",
  "NotificationEvent",
  "LineWebhookInbox",
  "LineFriend",
  "LineCustomerLink",
  "DailyJournalEntry"
TO bistro_app_runtime;

REVOKE UPDATE
ON TABLE
  "PrivateBlockAuditLog",
  "ReservationStatusAuditLog",
  "ReservationRateLimitEvent"
FROM bistro_app_runtime;

GRANT SELECT, INSERT
ON TABLE
  "PrivateBlockAuditLog",
  "ReservationStatusAuditLog",
  "ReservationRateLimitEvent"
TO bistro_app_runtime;
```

対象のPrisma modelはアプリ側でtext IDを生成するため、この14テーブルだけを目的とした `ON ALL SEQUENCES` の一括grantは不要です。他の業務テーブルへ権限を広げる場合も、必要なテーブルと操作を個別にレビューしてください。

> `GRANT` はRLSを迂回しません。接続roleがtable ownerでも `BYPASSRLS` roleでもない場合、切替前にそのruntime role向けの最小RLS policyを別migrationとしてレビュー・検証してください。権限SQLだけを先に適用して `DATABASE_URL` を切り替えないでください。

## Verification queries

```sql
SELECT
  c.relname AS table_name,
  has_table_privilege('bistro_app_runtime', c.oid, 'SELECT') AS can_select,
  has_table_privilege('bistro_app_runtime', c.oid, 'INSERT') AS can_insert,
  has_table_privilege('bistro_app_runtime', c.oid, 'UPDATE') AS can_update,
  has_table_privilege('bistro_app_runtime', c.oid, 'DELETE') AS can_delete,
  has_table_privilege('bistro_app_runtime', c.oid, 'TRUNCATE') AS can_truncate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'Reservation',
    'BusinessDay',
    'PrivateBlockAuditLog',
    'ReservationStatusAuditLog',
    'ReservationEmailOutbox',
    'ReservationIdempotency',
    'ReservationLineLinkToken',
    'ReservationManagementToken',
    'NotificationEvent',
    'LineWebhookInbox',
    'ReservationRateLimitEvent',
    'LineFriend',
    'LineCustomerLink',
    'DailyJournalEntry'
  )
ORDER BY c.relname;
```

期待値:

1. 上表で定義した `SELECT`, `INSERT`, `UPDATE` だけが `true`
2. 全14テーブルで `can_delete = false`
3. 全14テーブルで `can_truncate = false`
4. 追記型3テーブルで `can_update = false`

`supabase/verify.sql` は、この期待値を読み取りだけでassertできます。repo rootから `psql` を使う場合は、エラーを終了コードへ反映させ、roleを明示してください。

```sql
BEGIN READ ONLY;
SET LOCAL bistro.verify_runtime_role = 'bistro_app_runtime';
-- psqlではここで \i supabase/verify.sql を実行する
ROLLBACK;
```

- `psql` は `-v ON_ERROR_STOP=1` を付ける。
- `bistro.verify_runtime_role` に指定したroleが存在しない場合はFAILする。
- roleを指定せず、既定名 `bistro_app_runtime` も存在しない環境では、role検証だけを明示的にSKIPし、テーブル/RLS/policy/FKのassertは継続する。
- 実行結果に予約行や個人情報は含まれない。

## Rollback example

このhardeningのrollbackでも、保護対象へ `DELETE` / `TRUNCATE` を一括付与しないでください。適用前に取得したrole別privilege一覧を正本とし、DB管理者レビュー済みの権限だけを個別に戻します。

1. 適用前の `information_schema.role_table_grants` 結果を保存する。
2. 障害時は、欠けている非破壊権限だけを特定する。
3. `SELECT` / `INSERT` / `UPDATE` のうち、事前snapshotで確認できる権限だけを個別に復元する。
4. `DELETE` / `TRUNCATE` が必要に見える場合はrollbackを中止し、アプリ処理またはRLS policyの不整合を先に調査する。
5. 事前snapshotがない場合は推測でgrantせず、migration用roleへ一時切替する判断も含めて運用責任者の承認を得る。

## Operational notes

1. アプリの `DATABASE_URL` には runtime ユーザーを使う
2. migration 実行時だけ migration 用接続情報を使う
3. 本番で destructive cleanup や restore SQL を流す前提にしない
4. 予約キャンセルは削除ではなく `Reservation.status = CANCELLED`
5. No-show は削除ではなく `Reservation.status = NOSHOW`
6. 来店済みは削除ではなく `Reservation.status = DONE`
7. `ReservationEmailOutbox`、監査、LINE token、予約管理token、Webhook inbox、通知台帳、日誌、rate-limit記録を通常のcleanup対象にしない
8. migration・grant・RLS適用後は `supabase/verify.sql` が例外なしで完了するまでreleaseを進めない
