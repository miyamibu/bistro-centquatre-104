# LINE前日リマインド: 本番デプロイ手順

このドキュメントは、実装済みコードを本番（Vercel `bistro-centquatre-104`）に反映する手順をまとめる。

- 前段: [line-reminder-production-setup.md](line-reminder-production-setup.md) → [line-reminder-vercel-env.md](line-reminder-vercel-env.md) → [line-reminder-db-migration.md](line-reminder-db-migration.md)
- 後段: [line-reminder-e2e-test.md](line-reminder-e2e-test.md)

---

## 0. 安全原則（絶対遵守）

- `git push` / `vercel deploy` を**勝手に実行しない**。ユーザーの「本番反映を許可: …」明示承認後のみ実行する。
- **`git add .` / `git commit -a` を使わない**。LINE 関連と無関係の差分を巻き込む。
- secret / token / DATABASE_URL / CRON_SECRET の値をログ・チャット・コミットメッセージ・PR 本文に貼らない。
- `main` / `master` / `production` ブランチへ直接 push しない（feature branch を経由する）。
- `--no-verify` で pre-commit hook をスキップしない。
- 既存の他デプロイドキュメント（[DEPLOYMENT_SETUP.md](../DEPLOYMENT_SETUP.md) / [docs/production-launch.md](production-launch.md) / [docs/vercel-production-env.md](vercel-production-env.md)）の運用ルールに矛盾する手順は提案しない。矛盾を見つけたら本ドキュメントを停止して整合確認する。

---

## 1. 現状整理

| 項目 | 状態 |
|---|---|
| 現在ブランチ | `main` |
| git remote | **未設定**（`git remote -v` で何も返らない） |
| 最新コミット | `0eec917 Harden local data safety` |
| Vercel プロジェクト | `.vercel/project.json` で `bistro-centquatre-104` にリンク済（org/project ID も既存） |
| 未コミット変更 | **大量にあり**。29 ファイルが modified、多数の新規ファイルが untracked。LINE 関連以外の差分（daily-journal、recovery、scripts/security、artifacts、deliverables、.agents/、.codex/ など）も混在している |
| Vercel CLI | システムグローバル未インストール。`npx vercel` 経由で 53.3.2 が利用可能、既存セッションでログイン済 |

**最大リスク**: 現在の差分を `git add .` でまとめて commit すると、LINE 通知 MVP に関係ない大規模な変更（admin/daily-journal、recovery 関連 docs、scripts、tests など）が一緒に本番に出てしまう。Production への影響が読みにくく、何か壊れても LINE と無関係の変更が原因かどうか切り分けにくくなる。

---

## 2. 推奨デプロイ方針

**LINE 関連の変更だけを分離して feature branch / PR / deploy する。`main` の未関係差分を巻き込まない。**

具体的には:

1. 既存の `main` ローカル差分はそのまま残す（commit しない）。
2. 新規 feature branch を作る（remote は別途用意）。
3. **LINE MVP 関連ファイルだけを明示的に `git add` する**（`git add .` 禁止）。
4. 1 コミットにまとめて `feature/line-reminder-mvp` ブランチで保管。
5. remote と PR フローが整ったら push → review → merge → Vercel 自動デプロイ。
6. CLI 派の場合は `npx vercel deploy` で Preview → 確認 → `--prod` で Production。

---

## 3. LINE 関連として含めるべきファイル一覧（候補）

実差分は `git status --short` で必ず再確認すること。下記はチェックリスト。

### コード本体（modified）

- `prisma/schema.prisma`
- `src/lib/env.ts`
- `src/lib/env-public.ts`
- `src/lib/validation/reservations.ts`
- `src/lib/admin-reservation-mock.ts`（lineReminder* フィールド追加に伴う型整合）
- `src/components/reserve-form.tsx`
- `src/app/api/reservations/route.ts`
- `src/app/api/crons/remind/route.ts`
- `vercel.json`

### コード本体（新規）

- `src/lib/line.ts`
- `src/app/api/cron/remind/route.ts`（既存 alias の維持確認用、もし新規扱いなら含める）
- `src/app/api/line/webhook/route.ts`
- `prisma/migrations/20260511120000_add_line_reminder_fields/migration.sql`（ディレクトリごと）

### 依存

- `package.json`
- `package-lock.json`

### env テンプレ

- `.env.example`
- `.env.local.example`

### テスト

- `tests/line-verify.test.ts`
- `tests/line-webhook.test.ts`
- `tests/line-helpers.test.ts`
- 既存 `tests/env-validation.test.ts` は今回触っていない（Phase 1 で確認済）。**差分があるなら本変更とは関係ない別経緯なので分離対象**。

### ドキュメント

- `docs/line-reminder-mvp.md`（既存仕様書）
- `docs/line-reminder-production-setup.md`
- `docs/line-reminder-vercel-env.md`
- `docs/line-reminder-db-migration.md`
- `docs/line-reminder-deployment.md`
- `docs/line-reminder-e2e-test.md`（Phase 6 で作成予定）

---

## 4. 逆に含めないファイル（本リリースから除外）

`git status` 上に見えても、LINE 通知 MVP と無関係なものは別のリリースに分けること:

- `src/app/admin/page.tsx`, `src/app/admin/daily-journal/`, `src/app/api/admin/daily-journal/`, `src/app/api/admin/backups/`, `src/app/api/daily-journal/`, `src/app/daily-journal/`, `src/lib/daily-journal/`（管理画面・日々の出来事関連）
- `prisma/migrations/20260506093000_add_daily_journal_entry/`（既に過去に追加された別 feature の migration）
- `docs/recovery/*`, `docs/prompts/*`, `docs/production-launch.md` 等（recovery / launch doc 関連の修正）
- `scripts/recovery/`, `scripts/security/`, `scripts/export-reservation-site-understanding-report.mjs`, `scripts/cleanup-reservation-backups.ts`, `scripts/run-local-safety-backups.mjs`
- `prisma/seed.ts`（シード変更は今回の MVP と無関係）
- `tests/private-block-route-db.test.ts`, `tests/reservations-route-db.test.ts`, `tests/test-database.ts`, `tests/security-destructive-reservations.test.ts`, `tests/types/`, `tests/utils/`
- `src/app/api/admin/reservations/[id]/route.ts`, `src/components/app-shell.tsx`, `src/components/top-nav.tsx`, `src/middleware.ts`, `src/app/page.tsx` の **LINE と無関係な差分**
  - 注: `src/app/page.tsx` は本セッションでホームの READ MORE リンク変更を加えているが、これは LINE MVP の本筋ではないため、デプロイの混入リスクを下げるなら別リリース推奨。**ユーザー判断で含めるかどうか決める**。
- `README.md`, `.gitignore`, `.env.test.example` の LINE 無関係な差分
- `AGENTS.md`, `CODEX_INSTRUCTIONS.md`, `DESIGN.md`（meta 系）
- `.agents/`, `.codex/`, `artifacts/`, `deliverables/`, `types/`, `.github/workflows/security-checks.yml`

---

## 5. 安全な commit 方法

`git add .` は禁止。下記のように個別 add する（**Phase 5 では実行しない、docs 例として記載**）:

```bash
# 念のため最終確認
git status --short

# LINE 関連ファイルだけを個別に add
git add .env.example .env.local.example
git add package.json package-lock.json
git add prisma/schema.prisma
git add prisma/migrations/20260511120000_add_line_reminder_fields
git add src/lib/env.ts src/lib/env-public.ts src/lib/line.ts
git add src/lib/validation/reservations.ts src/lib/admin-reservation-mock.ts
git add src/components/reserve-form.tsx
git add src/app/api/reservations/route.ts
git add src/app/api/crons/remind/route.ts
git add src/app/api/cron/remind/route.ts
git add src/app/api/line/webhook/route.ts
git add vercel.json
git add tests/line-verify.test.ts tests/line-webhook.test.ts tests/line-helpers.test.ts
git add docs/line-reminder-mvp.md
git add docs/line-reminder-production-setup.md
git add docs/line-reminder-vercel-env.md
git add docs/line-reminder-db-migration.md
git add docs/line-reminder-deployment.md
git add docs/line-reminder-e2e-test.md
```

**注意**:
- 上のリストにあっても、`git diff -- <file>` で LINE 通知 MVP に関係ない差分が混ざっていたら、その差分は別ブランチに切り出してから個別 add する。例えば `src/components/reserve-form.tsx` には LINE 関連の差分のみが入っているはずだが、`.gitignore` / `README.md` などは 巻き込みやすい。
- `git diff --cached` で stage 内容を再確認してから commit する。
- コミットメッセージに secret / token を貼らない。

例:

```bash
git diff --cached  # ステージ内容を目視確認

git commit -m "Add LINE reservation reminder MVP (LIFF flow, push cron, webhook)"
```

`Phase 5 では実行しない`。本ドキュメントは手順記述のみ。

---

## 6. デプロイ前の必須順序

```text
1. LINE Developers Console 設定完了           ← line-reminder-production-setup.md
2. Vercel env 4 つ投入                        ← line-reminder-vercel-env.md
3. 本番 DB migration 適用                     ← line-reminder-db-migration.md
4. 新コード deploy                            ← 本ドキュメント §7
5. LINE 実機テスト                            ← line-reminder-e2e-test.md
```

**理由**: 新コードは `Reservation.lineReminderSentAt` 等の新カラムを参照する。DB migration が先にあると、新コードが本番投入された瞬間から問題なく動く。逆順だと、コードが「まだ存在しないカラム」にアクセスして 500 を返す瞬間が生じる。

---

## 7. デプロイ方式（2 案）

remote が未設定なので、運用に応じて選ぶ。

### 案 A: GitHub remote + PR 経由（推奨）

長期運用に向く。Vercel の GitHub 連携で自動 Preview / Production が動く。

```bash
# 0. （手作業）GitHub 上で空リポジトリを作る or 既存リポジトリを特定
#    URL: 例) git@github.com:<org>/bistro-reservation.git

# 1. remote 登録
git remote add origin <repo-url>

# 2. feature branch を切る
git checkout -b feature/line-reminder-mvp

# 3. §5 の手順で個別に git add → commit
#    （Phase 5 では実行しない）

# 4. 明示承認後のみ push
git push -u origin feature/line-reminder-mvp
```

- GitHub 上で PR を作って Vercel の Preview deployment URL が出る。
- Preview で `/booking`、LIFF 連携、cron 手動実行までを試す。
- レビューを通して `main` に merge → Vercel が自動 Production deploy。
- Vercel の GitHub 連携が未設定なら、Vercel Dashboard → Project Settings → Git で接続する必要がある。

### 案 B: Vercel CLI 直接 deploy

remote が用意できない・短期で出したい場合。

```bash
# Preview deployment（明示承認後のみ）
npx vercel deploy

# 期待出力（URL は実値、ここには貼らない）:
# Inspect: https://vercel.com/.../inspect
# Preview: https://bistro-centquatre-104-<hash>.vercel.app

# Production deployment（明示承認後のみ、Preview で動作確認後）
npx vercel deploy --prod
```

- `vercel deploy` はローカルディレクトリのファイルをそのままアップロードする。**未コミットの非 LINE 差分も含まれてしまう**ため、案 B を使う場合は事前に LINE 関連だけを別 worktree / 別ディレクトリに切り出すか、ローカルで非関係差分を `git stash` する。
- `git stash` で退避する手順は §8 を参照。

---

## 8. 案 B を使う場合の安全策（git stash で他差分を退避）

非関係差分を一旦 stash し、LINE 差分だけが working tree に残る状態を作る。

```bash
# 1. 念のため全差分を確認
git status --short

# 2. LINE 関連ファイルを listing
LINE_FILES=(
  .env.example
  .env.local.example
  package.json
  package-lock.json
  prisma/schema.prisma
  prisma/migrations/20260511120000_add_line_reminder_fields/
  src/lib/env.ts
  src/lib/env-public.ts
  src/lib/line.ts
  src/lib/validation/reservations.ts
  src/lib/admin-reservation-mock.ts
  src/components/reserve-form.tsx
  src/app/api/reservations/route.ts
  src/app/api/crons/remind/route.ts
  src/app/api/cron/remind/route.ts
  src/app/api/line/webhook/route.ts
  vercel.json
  tests/line-verify.test.ts
  tests/line-webhook.test.ts
  tests/line-helpers.test.ts
  docs/line-reminder-mvp.md
  docs/line-reminder-production-setup.md
  docs/line-reminder-vercel-env.md
  docs/line-reminder-db-migration.md
  docs/line-reminder-deployment.md
  docs/line-reminder-e2e-test.md
)

# 3. LINE 関連だけを keep し、それ以外を stash する手順は複雑になる。
#    案 B を使うなら、案 A よりむしろ「LINE 専用 worktree」を作る方が安全。
git worktree add ../bistro-reservation-line feature/line-reminder-mvp

# 4. ../bistro-reservation-line ディレクトリで案 A の commit 手順を実施し、そこから vercel deploy する。
```

`vercel deploy` を新しい worktree から行うには、その worktree 配下にも `.vercel/project.json` が必要（コピーするか、`vercel link` で再リンクする）。実運用では案 A の方が事故が少ない。

---

## 9. 本番 deploy 後の確認（実機テストへの橋渡し）

deploy 完了後、すぐに以下を最低限確認する（詳細手順は [line-reminder-e2e-test.md](line-reminder-e2e-test.md)）:

- [ ] `https://<本番ドメイン>/booking` が 200 で表示できる
- [ ] `NEXT_PUBLIC_LIFF_ID` が反映され、ブラウザ DOM に「LINE」ボタンが描画されている
- [ ] LINE 連携なしの通常予約が従来通り成功する
- [ ] LIFF 経由予約で `Reservation.lineUserId` が保存される（管理画面か DB read で確認）
- [ ] `/api/crons/remind` を Bearer `CRON_SECRET` で手動 POST すると summary JSON が返る
- [ ] `Reservation.lineReminderSentAt` / `lineReminderStatus` が成功時に更新される
- [ ] 同じ予約に対して二重送信されない（2 回目の cron で `sent: 0` になる）
- [ ] `/api/line/webhook` が Verify ボタンで 200 を返す（任意設定したなら）

---

## 10. rollback 方針

問題が発生した場合の戻し方:

### 10.1 アプリ側（最も軽い rollback）

Vercel Dashboard → Deployments で、直前の Production deployment の「Promote to Production」を押す。即時で旧コードに戻る。DB は新カラムを保持したままで問題ない（旧コードは無視するだけ）。

```bash
# CLI でも可（明示承認後のみ）
npx vercel rollback <previous-deployment-url> --scope <team-slug>
```

### 10.2 LINE 機能だけ無効化

env を一時的に外す:

```bash
# 明示承認後のみ。値は表示しない。
npx vercel env rm LINE_CHANNEL_ACCESS_TOKEN production
```

`LINE_CHANNEL_ACCESS_TOKEN` を外すと `hasLineMessagingEnv()` が false を返し、cron は `SKIPPED_LINE_SETUP` を返すだけになる。通常予約は影響を受けない。LIFF ボタンを完全に消したいなら `NEXT_PUBLIC_LIFF_ID` も外す。

### 10.3 DB rollback（最終手段）

追加カラムだけなので、通常は残してよい（旧コードは無視する）。

どうしても剥がす場合は [line-reminder-db-migration.md](line-reminder-db-migration.md) §8 のロールバック SQL を、店舗運用者の明示承認後に Supabase Dashboard 経由で実行する。Claude Code は自動実行しない。

### 10.4 git rollback

feature branch を `git revert` で取り消すか、`main` を直前タグに戻す。`git push --force` は禁止。**`origin/main` を歴史改変する操作は store 運用に影響するため、ユーザーの明示承認が必要**。

---

## 11. ユーザーへの承認依頼テンプレ

deploy 段階で以下の承認文を順に提示する:

```
本番反映を許可: git checkout -b feature/line-reminder-mvp（branch 作成、書き込みなし）
本番反映を許可: git add (LINE 関連ファイルのみ、§5 のリスト)
本番反映を許可: git commit (LINE MVP 1 コミット)
本番反映を許可: git push origin feature/line-reminder-mvp（remote が用意できている場合）
本番反映を許可: Vercel preview deploy via `npx vercel deploy`
本番反映を許可: Vercel production deploy via `npx vercel deploy --prod`
```

それぞれ独立に承認を求める。一括承認は受けない。
