# LINE前日リマインド: 本番DB migration 手順

このドキュメントは Supabase の本番 PostgreSQL に対する Prisma migration（`20260511120000_add_line_reminder_fields`）の安全適用手順をまとめる。

- 前段: [line-reminder-production-setup.md](line-reminder-production-setup.md) → [line-reminder-vercel-env.md](line-reminder-vercel-env.md)
- 後段: [line-reminder-deployment.md](line-reminder-deployment.md) → [line-reminder-e2e-test.md](line-reminder-e2e-test.md)

---

## 0. 安全原則（絶対遵守）

- 本番 DB に対する書き込みは**ユーザーの明示承認後のみ**実行する。
- `prisma migrate dev` / `prisma db push` を**本番 DB に対して絶対に使わない**（schema を強制同期して破壊的変更を入れうる）。
- `DATABASE_URL` の値をログ・チャット・スクショに出さない。
- 本番 DB に手書き SQL を直接流さない。Prisma migration ファイルのみを正規ルートとして使う。
- 適用前に必ず本番 DB のバックアップが存在することを確認する。
- **`prisma migrate status` の `up to date` 表示だけでは migration 完了とみなさない**。`_prisma_migrations` の状態は対象 DB を間違えると別 DB の状態を答えるため、`information_schema.columns` で対象カラムの実在を独立確認するまで「完了」と判定しない（§6.3、§9 参照）。

---

## 1. 今回の migration の内容

ファイル: `prisma/migrations/20260511120000_add_line_reminder_fields/migration.sql`

```sql
ALTER TABLE "Reservation" ADD COLUMN "lineReminderSentAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "lineReminderStatus" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "lineReminderError" TEXT;

CREATE INDEX "Reservation_lineReminderSentAt_idx" ON "Reservation" ("lineReminderSentAt");
```

| 変更 | 用途 |
|---|---|
| `lineReminderSentAt TIMESTAMP(3) NULL` | 前日リマインド送信完了時刻。送信前は NULL。cron 抽出条件 `lineReminderSentAt IS NULL` で再送候補を判定する。 |
| `lineReminderStatus TEXT NULL` | `"SENT"` / `"FAILED"` / `"SKIPPED_QUOTA"` のいずれか。NULL は未送信。 |
| `lineReminderError TEXT NULL` | 失敗時の丸めたエラー文。secret/token は含めない。 |
| `Reservation_lineReminderSentAt_idx` | 月次カウント `prisma.reservation.count({ where: { lineReminderSentAt: { gte: monthStart } } })` を高速化。 |

---

## 2. SQL 安全性評価

| 項目 | 評価 |
|---|---|
| 操作種別 | `ALTER TABLE ADD COLUMN` ×3 と `CREATE INDEX` ×1 のみ |
| NOT NULL 制約 | **なし**（全カラム NULL 許容、既存行への DEFAULT 値挿入も不要） |
| DEFAULT 値 | なし（旧データは NULL のまま、Prisma 側で `null` として扱われる） |
| 既存データ書き換え | **なし**（既存 Reservation 行は ALTER 後も完全に同一） |
| 既存カラム削除・rename | なし |
| 既存制約変更 | なし |
| index 作成のロック影響 | `CREATE INDEX`（CONCURRENTLY なし）は対象テーブルに ShareLock を取り、書き込みが短時間ブロックされる可能性あり。`Reservation` の件数規模（数千〜数万件想定）なら数秒以内で完了する見込み。営業時間外推奨。 |
| ロールバック容易性 | 高い。`ALTER TABLE ... DROP COLUMN` で完全に戻せる。アプリ側が旧コード（このカラムを読み書きしないバージョン）に戻れば、追加カラムを残したままでも実害なし。 |

**結論: 破壊的変更なし。安全。** 念のため適用は店舗の営業時間外（ランチ・ディナー帯外）に行うのが望ましい。

---

## 3. デプロイ・migration の推奨順序

新コードは新カラム（`lineReminderSentAt` 等）を読み書きする。**DB カラムが先にある状態で新コードがデプロイされるべき。**

```text
1. LINE Developers Console 設定完了        ← line-reminder-production-setup.md
2. Vercel Production env に LINE 4 値投入  ← line-reminder-vercel-env.md
3. 本番 DB バックアップ確認                ← 本ドキュメント §4
4. 本番 DB に migration 適用               ← 本ドキュメント §6
5. 新コードを本番 deploy                   ← line-reminder-deployment.md
6. LINE 実機テスト                         ← line-reminder-e2e-test.md
```

理由:
- 順序を逆にすると、新コードが「まだ存在しないカラム」にアクセスして 500 を返す瞬間が発生する。
- migration を先に当てれば、新コード未デプロイ状態でも旧コードは新カラムを無視するだけで何も壊れない。

---

## 4. 適用前チェックリスト

実行を承認する前に以下を全て確認する。

- [ ] 本番 DB（Supabase）のバックアップが直近で取れている
  - Supabase Dashboard → Project → Database → Backups で日次バックアップが回っていることを確認。
  - 念のため適用直前に手動スナップショットを取る（Supabase 有料プランは PITR 可、無料プランは日次のみ）。
- [ ] Vercel Production env に `DATABASE_URL` が登録済（Phase 3 で確認済）。
- [ ] Vercel Production env に `CRON_SECRET` が登録済（Phase 3 で確認済、既存運用）。
- [ ] Vercel Production env に LINE 4 値が投入済（[line-reminder-vercel-env.md](line-reminder-vercel-env.md) §5 で確認）。
- [ ] Migration ファイルが手元と本番リポジトリで一致している。
- [ ] 本番 DB が現在オープンなトランザクションを抱えていない（業務時間外に実行する）。
- [ ] 本番作業を行う作業者・実行時刻を関係者に共有済み。

---

## 5. 現状の build / deploy flow と migration の関係

`package.json` を確認した結果:

```json
"build": "prisma generate && next build",
"postinstall": "prisma generate",
"prisma:migrate": "prisma migrate dev"
```

- **`prisma migrate deploy` は build フローに組み込まれていない**。Vercel のビルドは `prisma generate`（クライアント生成）のみ。
- これは安全側の設計だが、裏返すと **本番 DB migration は人間が手動で 1 回流す必要がある**。
- `prisma:migrate` は `migrate dev`（開発用、schema drift を強制修正する）なので本番では絶対に使わない。

---

## 6. 適用コマンド（**明示承認後のみ実行**）

### 6.1 推奨: Vercel CLI で本番 env を一時的に注入して実行

```bash
# 状態確認: 明示承認後のみ
vercel env run -- npx prisma migrate status --schema prisma/schema.prisma

# 本番適用: 明示承認後のみ
vercel env run -- npx prisma migrate deploy --schema prisma/schema.prisma
```

- `vercel env run` は Production env を子プロセスにのみ渡し、ローカルの環境変数や `.env*` ファイルを汚さない。
- `DATABASE_URL` は子プロセス内にだけ存在し、shell history にもログにも残らない。
- 期待出力（`migrate status`）:
  ```
  Database schema is up to date!
  - 6 migrations found in prisma/migrations
  - 1 migrations have not yet been applied:
      20260511120000_add_line_reminder_fields
  ```
- 期待出力（`migrate deploy`）:
  ```
  The following migration(s) have been applied:
    20260511120000_add_line_reminder_fields/
  All migrations have been successfully applied.
  ```

### 6.2 代替: ローカル `.env.production.local` を一時利用（非推奨）

CI/CD への組み込みなど用途で必要な場合のみ。

```bash
# 本番 DATABASE_URL を一時ファイルに書く。権限を 600 に絞る。
umask 077
# ※ DATABASE_URL の値はここに貼らない。エディタで開き、Vercel の値を一時的に転記する。

chmod 600 .env.production.local

# 明示承認後のみ
npx dotenv-cli -e .env.production.local -- npx prisma migrate deploy --schema prisma/schema.prisma

# 完了後すぐに削除
shred -u .env.production.local 2>/dev/null || rm -P .env.production.local
```

- このやり方はファイル削除忘れリスクがあるため、§6.1 を優先する。

### 6.3 適用後の確認（**両方とも必須**）

#### (a) migration tracking 確認（read-only）

```bash
# 適用済み migration 一覧を確認（read-only）
vercel env run -- npx prisma migrate status --schema prisma/schema.prisma
```

期待出力:

```
Database schema is up to date!
```

#### (b) 対象カラムの実在を**独立確認**（必須 / read-only）

`migrate status` だけで完了と判定しない。本番 deploy 前 / 「migration 完了」と宣言する前に、必ず下記 SQL を `vercel env run -e production -- node <一時スクリプト>` 等で実行し、対象カラムが実在することを確認する。

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'Reservation'
  AND column_name LIKE 'lineReminder%'
ORDER BY column_name;
```

期待値: **3 行揃って返ること**。

- `lineReminderSentAt`（TIMESTAMP, nullable）
- `lineReminderStatus`（TEXT, nullable）
- `lineReminderError`（TEXT, nullable）

3 行未満なら**未適用**（または別 DB に適用された drift）。その状態で新コードを deploy / 再デプロイすると `RESERVATION_SCHEMA_NOT_READY` で `/api/availability*` が 503 を返し `/booking` が壊れる。**必ず (a) と (b) の両方が pass するまで deploy しない**。

#### (c) DIRECT_URL を user terminal で入力する場合の DB 対象確認（必須）

`vercel env run` が `--sensitive` 環境変数（`DIRECT_URL` 等）を取得できないため、user が `read -rsp` 経由で URL を手入力して migrate を回す手順を取ることがある。この経路では「異なる Supabase プロジェクト / ブランチ DB の URL」を誤って入力する事故が起こりうる（過去 1 回発生済）。

URL ペースト後、`migrate deploy` 実行前に最低 1 件、対象 DB が本番であることを read-only で確認する:

```bash
# user terminal 例（値は表示しない）
read -rsp "DIRECT_URL: " DIRECT_URL && echo
DATABASE_URL="$DIRECT_URL" DIRECT_URL="$DIRECT_URL" \
  npx prisma db execute --stdin --schema prisma/schema.prisma <<'SQL'
-- 対象 DB が production か（ホスト名・DB 名を画面に出さない範囲で簡易確認したい場合、
-- Supabase Dashboard の Project Settings → Database の URI と末尾の英数字が一致するか目視で照合）
SELECT 1;
SQL
unset DIRECT_URL
```

または Supabase Dashboard → Project Settings → Database → Connection string の値と、貼り付けた URL の **project ref / ホスト名末尾**が一致することを目視確認する。一致しない場合は `migrate deploy` を実行しない。

---

## 7. 禁止事項（再掲）

- 本番 DB に `npx prisma migrate dev`
- 本番 DB に `npx prisma db push`
- 本番 DB に未レビューの手書き SQL を直接実行
- `DATABASE_URL` の値をエコー / コピー / スクショ / ログ出力
- migration の中身を本番直前に書き換える（既に GitHub / リポジトリに固定されたものだけを使う）
- 旧 migration を `migration_lock.toml` 直書きで「適用済み扱い」にする

---

## 8. 失敗時 / ロールバック方針

migration 適用が途中で失敗した場合の対応:

1. **追加でコマンドを叩かない**。`prisma migrate deploy` は本来トランザクション内で実行されるため、失敗時は部分適用されていない可能性が高い。
2. エラーメッセージを記録（token / DATABASE_URL を含まない形）。
3. アプリ側は新コードをまだデプロイしていない（§3 の順序を守っていれば）ので、Production はそのまま運用継続。
4. Supabase Dashboard で実際のテーブル状態を確認:
   - `lineReminder*` カラムが既に部分的に追加されてしまっている場合は、`ALTER TABLE "Reservation" DROP COLUMN ...` で剥がすことが可能（破壊的変更ではない、既存データに影響なし）。
   - ただし**本番 SQL の直叩きは店舗運用者の判断**。Claude Code は提案までで実行はしない。
5. 失敗原因（ロック競合・接続切れ・権限不足等）を切り分けた上で再適用。
6. どうしても解消できなければバックアップから DB を復元（最終手段、業務影響大）。

ロールバックが必要になった場合のテーブル状態リセット例（**実行は店舗運用者の明示判断後**）:

```sql
-- 万が一の手動巻き戻し。明示承認後のみ。
DROP INDEX IF EXISTS "Reservation_lineReminderSentAt_idx";
ALTER TABLE "Reservation" DROP COLUMN IF EXISTS "lineReminderError";
ALTER TABLE "Reservation" DROP COLUMN IF EXISTS "lineReminderStatus";
ALTER TABLE "Reservation" DROP COLUMN IF EXISTS "lineReminderSentAt";

-- 加えて、Prisma の _prisma_migrations テーブルから該当行を取り除く必要がある:
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260511120000_add_line_reminder_fields';
```

---

## 9. 最終チェックリスト

migration 適用＋本番デプロイ＋実機テストまで完了した時点で:

- [ ] `prisma migrate status` で「up to date」表示（§6.3(a)）
- [ ] **`information_schema.columns` で 3 カラム存在を独立確認（§6.3(b) 必須、これが無いと migration 完了と判定しない）**
- [ ] DIRECT_URL を手入力で `migrate deploy` した場合は、対象 DB が本番 project であることを Supabase Dashboard の URI と照合済（§6.3(c)）
- [ ] index `Reservation_lineReminderSentAt_idx` の存在を確認（`pg_indexes` で見られる）
- [ ] 本番予約作成（LINE なし）が通常通り通る
- [ ] 本番予約作成（LIFF 連携あり）で `Reservation.lineUserId` が保存される
- [ ] cron 手動実行で `sent >= 1` が返り、`lineReminderSentAt` が埋まる
- [ ] 旧予約（lineUserId が NULL）には何も影響していない
- [ ] secret 値（`DATABASE_URL` / `DIRECT_URL` / token / 個人情報）を一切ログ・チャット・コミット・スクショに出していない

---

## 10. ユーザーへの承認依頼テンプレ

実行直前に以下の承認文を提示する:

```
本番反映を許可: Prisma migrate status production DB (read-only)
本番反映を許可: Prisma migrate deploy production DB (additive ALTER TABLE)
```

承認後、Claude Code は §6.1 の `vercel env run --` 経由で実行する。それ以外の方法（直接 DATABASE_URL を打鍵する、`.env.production.local` を残す等）は取らない。
