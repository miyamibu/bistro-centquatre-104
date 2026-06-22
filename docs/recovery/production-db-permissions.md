# Production DB Permission Hardening

## Goal

本番運用中の `Reservation`、`PrivateBlockAuditLog`、`BusinessDay` を、アプリ実行ユーザーや誤操作から hard delete されにくい権限構成にする。

## Context

- `bistro-reservation` は予約受付だけでなく、貸切、営業日、監査、バックアップ/復旧も含む業務システムです。
- 2026-04-21 の復旧記録では、`DELETE FROM "Reservation"` の痕跡を含むデータ整合性問題が記録されています。
- アプリ側ガードだけでなく、本番DB権限でも `DELETE` / `TRUNCATE` を外して多層防御にします。

## Constraints

- この文書の SQL は例です。Codex は実行しません。
- 適用前に必ず DB 管理者または運用責任者が確認してください。
- migration 実行ユーザーと application runtime ユーザーは分離してください。

## Done when

- runtime ユーザーは `SELECT`, `INSERT`, `UPDATE` を持つ。
- runtime ユーザーは `Reservation`, `PrivateBlockAuditLog`, `BusinessDay` への `DELETE` / `TRUNCATE` を持たない。
- rollback 手順と確認クエリが用意されている。

## Recommended role split

1. `bistro_app_runtime`
   - 本番アプリ用
   - 必要権限は `SELECT`, `INSERT`, `UPDATE`
   - `Reservation`, `PrivateBlockAuditLog`, `BusinessDay` への `DELETE`, `TRUNCATE` は付与しない
2. `bistro_migration`
   - Prisma migration や管理者作業専用
   - スキーマ変更時だけ限定利用
   - 通常アプリ実行では使わない

## Example SQL

以下は PostgreSQL の一例です。実環境に合わせて DB 管理者が調整してください。

```sql
REVOKE DELETE, TRUNCATE
ON TABLE "Reservation", "PrivateBlockAuditLog", "BusinessDay"
FROM bistro_app_runtime;

GRANT SELECT, INSERT, UPDATE
ON TABLE "Reservation", "PrivateBlockAuditLog", "BusinessDay"
TO bistro_app_runtime;

GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA public
TO bistro_app_runtime;
```

必要に応じて、他の業務テーブルも同じ考え方で runtime ユーザーから `DELETE` / `TRUNCATE` を外してください。

## Verification queries

```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'bistro_app_runtime'
  AND table_name IN ('Reservation', 'PrivateBlockAuditLog', 'BusinessDay')
ORDER BY table_name, privilege_type;
```

期待値:

1. `SELECT`, `INSERT`, `UPDATE` はある
2. `DELETE` はない
3. `TRUNCATE` はない

## Rollback example

運用上やむを得ず権限を一時復元する場合も、DB 管理者レビューのうえで短時間だけ実施してください。

```sql
GRANT DELETE, TRUNCATE
ON TABLE "Reservation", "PrivateBlockAuditLog", "BusinessDay"
TO bistro_app_runtime;
```

rollback 後は、作業完了時点で必ず再度 `REVOKE DELETE, TRUNCATE` を実施してください。

## Operational notes

1. アプリの `DATABASE_URL` には runtime ユーザーを使う
2. migration 実行時だけ migration 用接続情報を使う
3. 本番で destructive cleanup や restore SQL を流す前提にしない
4. 予約キャンセルは削除ではなく `Reservation.status = CANCELLED`
5. No-show は削除ではなく `Reservation.status = NOSHOW`
6. 来店済みは削除ではなく `Reservation.status = DONE`
