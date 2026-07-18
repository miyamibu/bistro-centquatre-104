# LINE前日リマインド: Preview / Development env 戦略

このドキュメントは、Vercel Preview / Development 環境に LINE 4 env を投入する際の前提整理と、Preview deploy を機能させるために必要な周辺 env の方針をまとめる。

- 親ドキュメント: [line-reminder-vercel-env.md](line-reminder-vercel-env.md)
- 関連: [line-reminder-deployment.md](line-reminder-deployment.md) / [line-reminder-e2e-test.md](line-reminder-e2e-test.md)

---

## 0. このドキュメントの位置づけ

`docs/line-reminder-vercel-env.md` は「Production を含めた env 投入の全体像」を扱う。本ドキュメントはその中の **Preview / Development 部分で、Production env をそのままコピー・拡張しない方針** を補足する。

---

## 1. 現状の Vercel env

`npx vercel env ls <env>` を read-only で実行した結果（値は一切表示されない、env 名と暗号化フラグのみ）:

| 環境 | env 件数 | 備考 |
|---|---|---|
| Production | 23 | DB / Supabase / 管理者 / Cron / Contact / Email / 銀行履歴暗号鍵 / Backup 等。LINE 関連は 0 |
| Preview | **0** | 完全に空 |
| Development | **0** | 完全に空 |

**重要**: Preview に何も入っていないため、LINE 4 値だけを投入してもアプリ全体は起動できない。Vercel の Preview deploy は `NODE_ENV=production` で動くため、`src/lib/env.ts` の `superRefine` で `DATABASE_URL` / `ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS` / `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `CRON_SECRET` / `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY` の 7 値が必須となり、欠落でモジュール初期化エラーになる。

---

## 2. Preview に必要な env の分類表

各 env 名（Production に存在するもの + 今回新規追加の LINE 4 値）を、Preview / Development で何に必要かで分類する。**値は一切記載しない**。

### A. Preview deploy の build / 起動に必須（欠落で 500 や module init エラー）

| env 名 | 性質 | env.ts 上の扱い |
|---|---|---|
| `DATABASE_URL` | secret | requiredInProduction |
| `ADMIN_BASIC_USER` | server-only | requiredInProduction |
| `ADMIN_BASIC_PASS` | secret | requiredInProduction |
| `NEXT_PUBLIC_SUPABASE_URL` | 公開値 | requiredInProduction |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | requiredInProduction |
| `CRON_SECRET` | secret | requiredInProduction |
| `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY` | secret | requiredInProduction |

### B. `/booking` 表示・予約 API 動作に必要

| env 名 | 性質 |
|---|---|
| `DATABASE_URL` | A と重複（Reservation の read/write） |
| `NEXT_PUBLIC_SUPABASE_URL` | A と重複（クライアント側 Supabase） |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 公開値（クライアント側 Supabase anon） |
| `BASE_URL` | server-only（メール内 admin link 用） |
| `STORE_NAME` | server-only（メール / 表示） |
| `CONTACT_PHONE_E164` / `CONTACT_PHONE_DISPLAY` / `CONTACT_MESSAGE` | server-only（エラー時の電話案内） |
| `NEXT_PUBLIC_CONTACT_PHONE_E164` / `NEXT_PUBLIC_CONTACT_PHONE_DISPLAY` / `NEXT_PUBLIC_CONTACT_MESSAGE` | 公開値（フロントの電話案内） |

### C. 管理画面に必要

| env 名 | 性質 |
|---|---|
| `ADMIN_BASIC_USER` | A と重複（Basic 認証） |
| `ADMIN_BASIC_PASS` | A と重複（Basic 認証） |

### D. cron 手動実行に必要

| env 名 | 性質 |
|---|---|
| `CRON_SECRET` | A と重複（Bearer 認証） |

### E. LINE 連携に必要（**今回新規**）

| env 名 | 性質 |
|---|---|
| `NEXT_PUBLIC_LIFF_ID` | 公開値（LIFF 初期化） |
| `LINE_LOGIN_CHANNEL_ID` | server-only（ID token verify の `aud`） |
| `LINE_CHANNEL_ACCESS_TOKEN` | **secret**（Push API / Profile API Bearer） |
| `LINE_CHANNEL_SECRET` | **secret**（Webhook 署名検証） |

### F. 今回の LINE 検証には**不要**な env（Preview にはとりあえず入れなくてよい）

| env 名 | 用途 | 入れない理由 |
|---|---|---|
| `EMAIL_PROVIDER` / `RESEND_API_KEY` / `EMAIL_API_KEY` / `EMAIL_FROM` / `ADMIN_EMAIL` / `STORE_NOTIFY_EMAIL` | 予約完了メール送信 | Preview からテスト予約のたびに本物のメールが送信されないように、未設定のまま放置（コード側は send 失敗を握りつぶす） |
| `BANK_ACCOUNT_HISTORY_KEY_VERSION` | 銀行履歴暗号化のバージョン | オンラインストア機能、LINE 確認には不要 |
| `BACKUP_EXPORT_SECRET` | 予約バックアップ export 認証 | LINE と無関係 |
| `PRIVATE_BLOCK_ACCESS_CODE` | 貸切モード解除 | LINE と無関係 |

ただし、`BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY` は A の通り module init で必須。これは「鍵が存在さえすれば起動する」もので、本番の鍵を使う必要はない（Preview 用の別鍵で問題ない）。

### G. 本番値を Preview / Development に**流用してはいけない**（最重要）

| env 名 | 流用すると起きること |
|---|---|
| `DATABASE_URL` | Preview のテスト予約が**本番 Supabase に書き込まれる**。最大級の事故 |
| `SUPABASE_SERVICE_ROLE_KEY` | Preview から本番 Supabase に admin 権限でアクセスできてしまう |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 同上、フロントが本番 Supabase を叩く |
| `ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS` | Preview の Basic 認証が本番と同値、漏洩リスク |
| `CRON_SECRET` | Preview のリンクや手動 curl が本番 cron API を呼べてしまう |
| `BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY` | 本番銀行履歴を Preview で復号できる |
| `BACKUP_EXPORT_SECRET` | 本番バックアップを Preview から export できる |
| `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` | **本番公式アカウントの Push を Preview から発射できる**。テストでお客さまにトーク誤送信する可能性 |
| `RESEND_API_KEY` / `EMAIL_API_KEY` | Preview から本番メールが発射される |
| `ADMIN_EMAIL` / `STORE_NOTIFY_EMAIL` | テスト予約の通知が本番運用者に届く |

**結論**: A〜E のうち、Preview に必要なものは**すべて Preview 専用の別値**を用意する。Production との値同期は禁止。

---

## 3. Preview / Development に入れるべき推奨 env セット

Preview deploy を機能させるためには、最小で以下 19〜20 env を Preview 専用値で投入する必要がある。値は**本番と別**にする。

### 必須セット（Preview build / 起動 / `/booking` / 予約 / 管理画面 / cron / LINE まで動かす）

```text
A. 起動必須:
   DATABASE_URL                          ← staging/test PostgreSQL
   ADMIN_BASIC_USER                      ← Preview 用ユーザー名
   ADMIN_BASIC_PASS                      ← Preview 用パスワード（本番と別）
   NEXT_PUBLIC_SUPABASE_URL              ← staging/test Supabase URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY         ← staging/test Supabase anon key
   SUPABASE_SERVICE_ROLE_KEY             ← staging/test Supabase service role
   CRON_SECRET                           ← Preview 用 cron secret（本番と別）
   BANK_ACCOUNT_HISTORY_ENCRYPTION_KEY   ← Preview 用 32 byte ランダム

B. 表示・予約動作:
   BASE_URL                              ← Preview deployment URL (例: https://bistro-...-preview.vercel.app)
   STORE_NAME                            ← bistro centquatre 104 でも検証用名でも可
   CONTACT_PHONE_E164 / CONTACT_PHONE_DISPLAY / CONTACT_MESSAGE
   NEXT_PUBLIC_CONTACT_PHONE_E164 / NEXT_PUBLIC_CONTACT_PHONE_DISPLAY / NEXT_PUBLIC_CONTACT_MESSAGE

E. LINE 連携:
   NEXT_PUBLIC_LIFF_ID                   ← 検証用 LIFF ID (理想)、または本番 LIFF (要注意)
   LINE_LOGIN_CHANNEL_ID                 ← 上記 LIFF と同一 Provider
   LINE_CHANNEL_ACCESS_TOKEN             ← 検証用 Messaging API channel (理想)、または本番 (要注意)
   LINE_CHANNEL_SECRET                   ← 上記と同一 channel
```

### LINE channel 選択の判断軸

| 方式 | メリット | デメリット |
|---|---|---|
| 検証用 LINE channel / LIFF を別途作成 | 本番ユーザーに誤通知しない、自由にテスト可 | Provider / channel / LIFF 設定を再度全部やる必要、LINE Developers Console 上のリソースが増える |
| 本番 LINE channel / LIFF を流用 | 設定が 1 セットで済む | 自分の LINE アカウントで連携 → 自分にだけ Push する分には安全。**ただし、誤って他者の lineUserId が DB に入ると本番から Push されうる**。テスト予約は自分のアカウントだけで行うルールを厳守 |

推奨は**検証用 channel 別途作成**。ただし運用負荷との兼ね合いで、自分のアカウント限定運用が確実なら本番流用も可。

---

## 4. staging / test DB が無い場合の代替案

### 案 1: staging DB を作って Preview で安全に検証（推奨）

**手順**:

1. Supabase で別プロジェクトを作成（無料枠 OK）
2. 同じ migration を staging に流す:
   ```bash
   DATABASE_URL=<staging-url> npx prisma migrate deploy
   ```
   （Preview 用 DATABASE_URL を `.env.staging.local` 等に一時保存、権限 600）
3. Preview env 19 値を staging 値で投入
4. `npx vercel deploy` で Preview deployment URL を取得
5. その URL を LINE Developers Console の LIFF Endpoint URL に**一時的に**変更 → LIFF 動作確認
6. 検証完了後、LIFF Endpoint URL を本番ドメインに戻す
7. Preview の値はそのまま残しておけば次回も使える

**メリット**: 本番 DB / 本番ドメインに影響を与えずに、E2E をフルに検証できる。LINE 通知も自分の LINE で確認できる。

**デメリット**: Supabase / Vercel での追加セットアップ、LIFF Endpoint URL の差し替え運用。

### 案 2: Preview をスキップして Production で制御リリース

Preview 用 staging DB を用意するコストが見合わない場合の現実案。

**手順**:

1. Production env に LINE 4 値を投入（[line-reminder-vercel-env.md](line-reminder-vercel-env.md) §4 参照）
2. 本番 DB migration 適用（[line-reminder-db-migration.md](line-reminder-db-migration.md) §6 参照）
3. Production deploy（[line-reminder-deployment.md](line-reminder-deployment.md) §7 参照）
4. **営業時間外**（夜遅く or 早朝）に自分の LINE アカウントで /booking → 予約 → 翌朝 cron 着信を確認
5. 各操作は **1 つずつ承認** で進める（一括承認禁止）
6. テスト予約は管理画面から確実に CANCELLED に更新

**メリット**: staging DB が要らない、Vercel の 1 環境だけで済む。

**デメリット**: 本番 DB にテスト予約が一瞬入る（CANCELLED に変更しても監査ログには残る）、テスト失敗時の影響範囲が本番。

**判断材料**:
- LIFF / LINE Push の動作確認だけなら案 2 でも実害は小さい（自分のアカウント限定なら他者誤通知なし）。
- 大幅なコード変更が今後も続くなら案 1 を整備する価値あり。

---

## 5. env add コマンド例（**今回はコマンド提示のみ、実行しない**）

### 5.1 必ず environment を明示する

引数で environment を指定しない `vercel env add NAME` は対話プロンプトでチェック忘れにより複数環境に同時投入される事故が起きうる。**environment は引数で必ず指定する**。

### 5.2 Preview のみに投入する場合

```bash
# 値は対話プロンプトで入力（画面非表示、shell history に残らない）
npx vercel env add NEXT_PUBLIC_LIFF_ID preview
npx vercel env add LINE_LOGIN_CHANNEL_ID preview
npx vercel env add LINE_CHANNEL_ACCESS_TOKEN preview --sensitive
npx vercel env add LINE_CHANNEL_SECRET preview --sensitive
```

### 5.3 Preview と Development の両方に同じ値を入れる場合

各 env に対して 2 回ずつ実行（environment を明示）:

```bash
# Preview
npx vercel env add NEXT_PUBLIC_LIFF_ID preview
npx vercel env add LINE_LOGIN_CHANNEL_ID preview
npx vercel env add LINE_CHANNEL_ACCESS_TOKEN preview --sensitive
npx vercel env add LINE_CHANNEL_SECRET preview --sensitive

# Development
npx vercel env add NEXT_PUBLIC_LIFF_ID development
npx vercel env add LINE_LOGIN_CHANNEL_ID development
npx vercel env add LINE_CHANNEL_ACCESS_TOKEN development --sensitive
npx vercel env add LINE_CHANNEL_SECRET development --sensitive
```

### 5.4 禁止パターン

引数省略は禁止（対話で全環境にチェックが入る可能性）:

```bash
# ❌ 禁止
npx vercel env add NEXT_PUBLIC_LIFF_ID
npx vercel env add LINE_LOGIN_CHANNEL_ID
npx vercel env add LINE_CHANNEL_ACCESS_TOKEN --sensitive
npx vercel env add LINE_CHANNEL_SECRET --sensitive
```

### 5.5 投入後の read-only 確認

```bash
npx vercel env ls preview | grep -E "LIFF|LINE_"
npx vercel env ls development | grep -E "LIFF|LINE_"
```

期待: 4 行 × 2 環境（`Encrypted` のみ、値非表示）。

---

## 6. 次にユーザーが決めること

以下 3 点を決めてから、Phase 7c の実投入承認に進む。

### Q1. staging / test DB を用意するか

- **Yes（案 1 推奨）**: Supabase staging project 作成 → DATABASE_URL を Preview env に投入 → migration 適用 → Preview deploy で全機能 E2E
- **No（案 2 現実案）**: Preview スキップ、Production で制御リリース。本番 DB にテスト予約が一瞬残る点を受容

### Q2. Preview 検証を行うか、Production 制御リリースに直行するか

Q1 と連動するが独立判断も可:

- **Preview 検証あり**: A〜E の env を Preview 専用値で揃える。8〜19 env を `vercel env add ... preview` で投入
- **Production 直行**: Preview env 投入は省略。Production env 4 値だけ追加して、本番でテスト

### Q3. LINE channel を検証用 / 本番用どちらで作るか

- **検証用 channel 別作成**: 同一 Provider に 2 セット目を作る、本番ユーザーに誤通知しないが運用負荷
- **本番 channel 流用**: 自分の LINE アカウント限定でテスト。LIFF Endpoint URL 切替で対応可

---

## 7. 禁止事項（再掲）

- Production env の scope を Preview / Development に拡張する
- Production の `DATABASE_URL` / Supabase / Admin / Cron / 暗号鍵 / Backup などを Preview / Development に流用する
- Production env と同じ値を Preview にコピーする
- `vercel env add` を environment 引数なしで実行する
- secret / token / DATABASE_URL の値をログ・チャット・コミットメッセージに貼る
- 本ドキュメント作成時点では `vercel env add` / Production env 投入 / DB migration / deploy / push のいずれも実行しない
