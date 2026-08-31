# bistro centquatre 104 予約システム

Next.js App Router で構成した、レストラン予約 + オンラインストア + 管理画面のアプリです。  
データストアは以下の二系統を維持しています。

- 予約: Prisma + PostgreSQL
- 注文: Supabase (`orders`, `order_history`, `bank_account`)

## 技術スタック

- Next.js 15 / React 18 / TypeScript
- Prisma 5
- Supabase JS 2
- Tailwind CSS
- Vitest

## ディレクトリ

- `src/app` App Router ページ + API route
- `src/lib` ドメイン処理（認証、日付、API防御、validation、logger）
- `prisma/` スキーマ・マイグレーション
- `supabase/` SQL定義（DDL / RLS / 検証クエリ）
- `tests/` ユニットテスト

## セットアップ

1. 依存関係
```bash
npm install
```
2. 環境変数
```bash
cp .env.example .env
cp .env.local.example .env.local
```
3. Prisma
```bash
npx prisma migrate dev
npm run prisma:seed
```
4. 開発起動
```bash
npm run dev
```

リリース運用手順は `docs/production-launch.md` を参照してください。
実行対象と旧実装の区別は `docs/recovery/EXECUTION_TARGET.md` を参照してください。

Codex 作業ガイド:
- [CODEX_INSTRUCTIONS.md](/Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation/CODEX_INSTRUCTIONS.md)
- [docs/prompts/README.md](/Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation/docs/prompts/README.md)

## 環境変数

主要変数は `.env.example` に記載しています。特に以下は必須です。

- `DATABASE_URL`
- `DIRECT_URL`（Prisma migration用の直接接続。poolerを経由せず、`DATABASE_URL`と同じDBを指す）
- `TEST_DATABASE_URL`（破壊的DBテスト専用。`DATABASE_URL` と共有しない）
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `STAFF_SESSION_MAX_AGE_SECONDS`（900〜86400秒。既定8時間）
- `CRON_SECRET`
- `BACKUP_EXPORT_SECRET`
- `RATE_LIMIT_HASH_SECRET`
- `RESERVATION_TOKEN_KEYS_JSON` + `RESERVATION_TOKEN_ACTIVE_KEY_ID`（推奨。32文字以上の鍵を複数保持）
  または移行期間のみ `RESERVATION_TOKEN_SECRET`（32文字以上）
- `PRIVATE_BLOCK_ACCESS_CODE`（公開予約フォームで貸切モードを解放する管理用パスコード）
- `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY`
- `CONTACT_PHONE_E164`, `CONTACT_PHONE_DISPLAY`, `CONTACT_MESSAGE`

`BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY` は銀行口座履歴専用キーです。  
他用途 secret へのフォールバックは行わず、未設定時は安全側で失敗します。

予約token鍵輪番は `RESERVATION_TOKEN_KEYS_JSON='{"v1":"旧鍵...","v2":"新鍵..."}'` と
`RESERVATION_TOKEN_ACTIVE_KEY_ID=v2` で設定します。旧鍵は既存の管理リンク有効期間
（現在180日）が終わるまで保持し、期限経過後にだけ保管庫から廃棄します。

ローカルで `npm run build` まで通したい場合は、`.env.local.example` を `.env.local` にコピーして最低限の値を埋めてください。  
本番 secret をローカルに複製する必要はありませんが、`DATABASE_URL` や Supabase URL などは形式が正しい値が必要です。

破壊的なDBテストは `TEST_DATABASE_URL` が安全なローカル `*_test` DB を指す場合にだけ実行してください。
本番や共有DBの `DATABASE_URL` をテストに流用しないでください。

クライアント表示で連絡先を使う場合は以下も設定してください。

- `NEXT_PUBLIC_CONTACT_PHONE_E164`
- `NEXT_PUBLIC_CONTACT_PHONE_DISPLAY`
- `NEXT_PUBLIC_CONTACT_MESSAGE`

## 認証・保護範囲

### Supabase Auth（個別スタッフ・RBAC・パスワード認証）

以下パスはSupabase Authの個別セッションで保護されます。

- `/admin/:path*`
- `/dashboard/:path*`
- `/api/admin/:path*`
- `/api/dashboard/:path*`

Supabase Authユーザーの `app_metadata.role` に `STAFF` または `ADMIN` を設定してください。
通常の管理画面ログインはメールアドレスとパスワードで行い、TOTP MFAコードの入力は必須ではありません。
管理APIはサーバー側でもroleとセッションTTLを再検証します。
`ADMIN` のみ営業日・貸切・口座情報などの管理者操作を実行できます。
`STAFF_SESSION_MAX_AGE_SECONDS` を超えたセッションは再ログインが必要です。

初回ユーザー作成・招待はSupabase公式画面で行い、既存ユーザーへのrole付与だけを
`npm run staff:provision -- --email=<登録済みメール> --role=STAFF` で実施できます。
パスワードやMFA秘密値はスクリプトやリポジトリに渡しません。TOTP登録画面は必要な場合だけ利用する任意の追加設定です。

### Cron 認証（Bearer）

cron API は `Authorization: Bearer $CRON_SECRET` で保護されます。

- `/api/crons/remind`
- `/api/crons/cancel-expired-orders`
- `/api/crons/delete-old-histories`
- `/api/crons/process-order-notifications`
- `/api/crons/process-reservation-emails`
- `/api/cron/remind`（旧互換。内部で `/api/crons/remind` に委譲）

実行メソッドは `POST` を正とします。`GET` は Vercel Cron 互換のため、
`x-vercel-cron: 1` ヘッダーまたは `?compat=1` がある場合のみ受け付けます。

大量データ対策として cron はバッチ処理化しています。

- `cancel-expired-orders`: 1回実行あたり最大 200 件（`STATUS_FETCH_LIMIT=50` を反復）
- `delete-old-histories`: 1回実行あたり最大 1000 件（200件バッチ削除）

`vercel.json` の本番cron scheduleは次のとおりです。

| Endpoint | Schedule | 備考 |
| --- | --- | --- |
| `/api/crons/cancel-expired-orders` | `0 0 * * *` | 期限切れ注文を処理 |
| `/api/crons/delete-old-histories` | `0 1 * * *` | 古い注文履歴をバッチ処理 |
| `/api/crons/process-order-notifications` | `*/5 * * * *` | 5分ごとに注文通知outboxを処理。Vercel Pro相当のcron実行条件が必要 |
| `/api/crons/process-reservation-emails` | `*/5 * * * *` | 5分ごと。Vercel Pro相当のcron実行条件が必要 |
| `/api/crons/remind` | `0 3 * * *` | 予約リマインド |

2本の5分cronを有効にする場合は、release check実行時に `VERCEL_PLAN=pro` を指定してください。
`hobby` は失敗扱い、未指定はlocal/previewでは警告、productionでは失敗扱いです。
Vercel側の実プランとProduction環境変数は、デプロイ前に管理画面で確認してください。

## API 防御方針（CORS/CSRF）

書き込み API では共通防御 `src/lib/api-security.ts` を適用しています。

- `Content-Type: application/json` 必須
- `Origin` ヘッダーが必須で、同一オリジン（`request.nextUrl.origin` / `BASE_URL`）であること
- `Sec-Fetch-Site: cross-site` を拒否
- `X-Requested-With: XMLHttpRequest` は既定で必須
- `POST /api/reservations` は `Idempotency-Key` と同一bodyの再送を要求し、異なるbodyの同一keyを拒否する
- `POST /api/reservations` も同一オリジンのブラウザ予約フォームからのみ受け付ける
- AIエージェントの直接予約完了はlaunch-disabledで、`/booking?mode=agent` のhandoffのみを公開する

対象（主な書き込み API）:

- `POST /api/reservations`
- `POST /api/orders`
- `PUT|DELETE /api/dashboard/orders`
- `PUT|DELETE /api/dashboard/bank-account`
- `POST /api/admin/business-days`
- `PATCH /api/admin/reservations/[id]`
- `POST /api/pdf-to-image`

## API 一覧（主要）

- `GET /api/availability?date=YYYY-MM-DD`
- `GET /api/availability/monthly?month=YYYY-MM`
- `POST /api/reservations`
- `POST /api/orders`
- `GET|PUT|DELETE /api/dashboard/orders`
- `GET|PUT|DELETE /api/dashboard/bank-account`
- `GET|POST /api/admin/business-days`
- `GET /api/admin/reservations`
- `GET|PATCH /api/admin/reservations/[id]`
- `POST /api/crons/remind`
- `POST /api/crons/cancel-expired-orders`
- `POST /api/crons/delete-old-histories`
- `POST /api/crons/process-order-notifications`
- `POST /api/crons/process-reservation-emails`
- `POST /api/pdf-to-image`

## エラーレスポンス形式

バリデーション/認可エラーは以下形式で統一しています。

```json
{
  "error": "説明",
  "code": "MACHINE_READABLE_CODE",
  "fields": {
    "field": "message"
  }
}
```

`fields` は入力エラー時のみ付与されます。  
一部 API は障害追跡用に `requestId` を返します。

## 予約・注文ルール

- 予約は当日不可、最大3ヶ月先まで
- Web予約は最大12名まで。9名以上は電話受付のみ
- Web予約可能時間はランチ `11:30-12:30`、ディナー `17:30-19:30`
- 営業時間はランチ `11:30-14:00`、ディナー `17:30-22:00`（L.O. `21:00`）
- 店頭支払い（`cash-store`）の来店日は 木〜日かつ 注文日+14〜30日
- 予約完了画面または確認メールの管理リンクから、来店時刻の24時間前まで無料キャンセル可能。期限後の変更・キャンセルは電話で受付。現在、キャンセル料の設定・自動請求はなし
- `SHIPPED` / `CANCELLED` 到達時は `order_history` に終端スナップショットを archive する
- 問い合わせ/注文確認メールは fail-close。配信失敗時は API がエラーを返し、成功扱いにしない

## Prisma マイグレーション

マイグレーション状態を確認:

```bash
npx prisma migrate status
```

`Photo.category` 追補は以下で管理:

- `prisma/migrations/20260223224000_add_photo_category_column/migration.sql`

## Supabase SQL 適用手順

1. テーブル作成
```sql
-- supabase/schema.sql
```
2. RLS/Policy 適用
```sql
-- supabase/rls-policies.sql
```
3. 状態確認
```sql
-- supabase/verify.sql
```

## ログ運用（最小）

`src/lib/logger.ts` で JSON ログ化しています。  
主な項目:

- `level`
- `event`
- `requestId`
- `route`
- `errorCode`
- `context`

障害時は `requestId` と `errorCode` を起点に API ログを確認してください。

## テスト・リリース前チェック

```bash
npm run check:release
npm run lint
npm run typecheck
npm run test
npm run build
```

破壊的DBテストを含める場合:

```bash
TEST_DATABASE_URL=postgresql://user:password@127.0.0.1:5432/bistro_test ALLOW_DESTRUCTIVE_TEST_DB=1 npm run test:db
```

`npm run test:db` は `TEST_DATABASE_URL` が未設定なら実行せず成功終了し、
localhost/127.0.0.1 の `*_test` DB以外は拒否します。DBテスト本体を直接呼び出す
`npm run test:db:runner` は安全確認を迂回するため、通常の検証では使用しません。

## バックアップ保護

- 予約バックアップの既定保存先はリポジトリ内ではなく、OSごとのユーザーデータ領域です。
- 標準の保存先: `backups/reservation-daily-backups`
- 必要なら `BACKUP_OUTPUT_DIR` で上書きできます。
- 新規の予約payloadはアプリ層のAES-256-GCMで暗号化し、`*.json.enc` として保存します。
  復号鍵は `BACKUP_ENCRYPTION_KEYS_JSON` + `BACKUP_ENCRYPTION_ACTIVE_KEY_ID`（または移行用の
  `BACKUP_ENCRYPTION_KEY`）から取得し、CLI引数には渡しません。暗号文には鍵IDだけを記録します。
- `latest-run.json` や `runs/*.json` は件数・checksum等のメタデータのみで、予約payloadを含めません。
- 月1回 `npm run backup:restore-drill -- --file=<.enc>` を別ディレクトリで実行し、復号・件数・鍵IDを検証します。DBへは書き戻しません。
- 既存の平文バックアップ `*.json` は変更・削除せず、Gitにも含めない運用を継続します。
- `npm run backup:workspace:snapshot` を使うと、予約バックアップ実行後に Git bundle を外部ディレクトリへ保存します。
- 新規bundleのref範囲と世代保持方針は `docs/recovery/workspace-bundle-retention.md` を参照してください。既存bundleは自動削除しません。

まとめて流す場合は以下でも構いません。

```bash
npm run preflight
```

Preview へ出す前は、ローカル確認に加えて Vercel の `Preview` 環境にも以下の必須キーが入っていることを確認してください。

- `DATABASE_URL`
- `BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STAFF_SESSION_MAX_AGE_SECONDS`
- `CRON_SECRET`
- `BACKUP_EXPORT_SECRET`
- `RATE_LIMIT_HASH_SECRET`
- token keyring (`RESERVATION_TOKEN_KEYS_JSON` + `RESERVATION_TOKEN_ACTIVE_KEY_ID`, or migration secret)
- backup keyring (`BACKUP_ENCRYPTION_KEYS_JSON` + `BACKUP_ENCRYPTION_ACTIVE_KEY_ID`, or migration key)
- `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY`

全て成功してからデプロイしてください。
