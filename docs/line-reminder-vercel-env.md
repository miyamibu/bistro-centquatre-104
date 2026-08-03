# LINE前日リマインド: Vercel 環境変数 投入手順

このドキュメントは Vercel プロジェクト `bistro-centquatre-104` に必要な LINE 環境変数を投入する手順をまとめる。

- 前段: [line-reminder-production-setup.md](line-reminder-production-setup.md)（LINE Developers Console で 4 値を控える）
- 後段: [line-reminder-db-migration.md](line-reminder-db-migration.md) → [line-reminder-deployment.md](line-reminder-deployment.md) → [line-reminder-e2e-test.md](line-reminder-e2e-test.md)

---

## 0. 安全原則（絶対遵守）

- env の **値**（特に access token / secret / DATABASE_URL）をチャット・ログ・コミット・スクショに貼らない。
- `vercel env add` を**勝手に実行しない**。必ずユーザーから「本番反映を許可: Vercel env production …」の明示承認を得てから実行する。
- secret を含む値を **shell history に残さない**。後述の対話入力／一時ファイル方式を使う。
- 投入対象を間違えない（`production` / `preview` / `development` のどれに入れるか毎回確認）。

---

## 1. 監査結果（投入時点での前提）

`npx vercel env ls production` を read-only で実行した結果（値は一切表示されない、`Encrypted` のみ）:

| 環境 | LINE 関連 env の現状 | 補足 |
|---|---|---|
| Production | `LINE_LOGIN_CHANNEL_ID` / `LINE_CHANNEL_ACCESS_TOKEN` / `LINE_CHANNEL_SECRET` / 旧 `NEXT_PUBLIC_LIFF_ID` は投入済。`NEXT_PUBLIC_LIFF_BOOKING_ID` / `NEXT_PUBLIC_LIFF_LINK_ID` / `LINE_LINK_TOKEN_PEPPER` は未投入 | 旧 LIFF 名のままだと、予約用と連携用の LIFF を分離できない |
| Preview | env 未登録（空） | Preview deployment はビルド時に Production env を継承する設定になっていない |
| Development | env 未登録（空） | `vercel dev` 利用時のみ参照 |

旧 `LIFF_ID`（server-only 名）は Production に残っていない。旧 `NEXT_PUBLIC_LIFF_ID` は Production に残っているため、新名投入後に削除する。

---

## 2. 投入する env 一覧

**注意: `NEXT_PUBLIC_LIFF_ID`（旧名）は廃止済み。以下の新名を使うこと。**

| Env 名 | 性質 | 用途（コード上） | 入れる環境 |
|---|---|---|---|
| `NEXT_PUBLIC_LIFF_BOOKING_ID` | **公開値** （クライアントバンドルに焼き込まれる） | `/booking` ページ（予約フォーム）の LIFF 初期化 | Production + Preview + Development |
| `NEXT_PUBLIC_LIFF_LINK_ID` | **公開値** （クライアントバンドルに焼き込まれる） | `/line/link` ページ（後付け連携）の LIFF 初期化・連携 URL | Production + Preview + Development |
| `LINE_LOGIN_CHANNEL_ID` | server-only（秘匿性低） | `src/lib/line.ts` の `verifyLineIdToken` が ID token の `aud` を検証する | Production + Preview + Development |
| `LINE_CHANNEL_ACCESS_TOKEN` | **secret** | Push API / Profile API の Bearer。Webhook 署名鍵とは別物 | Production + Preview + Development |
| `LINE_CHANNEL_SECRET` | **secret** | `/api/line/webhook` の HMAC-SHA256 署名検証 | Production + Preview + Development |
| `LINE_LINK_TOKEN_PEPPER` | **secret** | 予約連携トークンの HMAC ペッパー（本番: 32 文字以上のランダム値必須） | Production + Preview + Development |
| `LINE_MONTHLY_REMINDER_LIMIT` | 設定値 | 月間送信上限（省略時 200） | Production + Preview |
| `LINE_MONTHLY_REMINDER_WARN_THRESHOLD` | 設定値 | 月間警告閾値（省略時 180） | Production + Preview |

加えて、予約発行tokenの生値をDBへ保存せず冪等再送で再生成するため、共通必須secret
`RESERVATION_TOKEN_SECRET`（32文字以上）をProduction + Preview + Developmentへ設定する。
これはLINE専用8項目の件数には含めない。

**LINE Developers Console で各 LIFF の設定値**:
- `NEXT_PUBLIC_LIFF_BOOKING_ID`: Booking LIFF の ID（Endpoint URL: `https://本番ドメイン/booking`）
- `NEXT_PUBLIC_LIFF_LINK_ID`: Link LIFF の ID（Endpoint URL: `https://本番ドメイン/line/link`）

注: `CRON_SECRET` は既存利用のためそのまま流用する。**今回新規投入の対象ではない。値の表示・コピーもしない。**

---

## 3. どの環境に入れるか

順番として、いきなり Production に入れず、まず Preview/Development で動作確認するのが安全。

### 3.1 Development（任意・vercel dev を使うなら）

- `vercel dev` で動かす場合のみ必要。普段 `npm run dev` を使うなら `.env.local` に入れる方が早い（`.env.local` 編集は人間が手で行う。Claude Code は触らない）。

### 3.2 Preview（推奨：先に入れて Preview deployment で確認）

- Vercel の Preview deployment URL（`bistro-centquatre-104-<hash>-<org>.vercel.app` 形式）で LIFF 連携→予約→ cron 手動実行までを試す。
- LINE Developers の LIFF Endpoint URL を Preview URL に一時的に差し替えるか、本番ドメインで Preview を試すかは運用で判断。

### 3.3 Production（最後・実機テスト終了後）

- Preview で動作確認できてから Production に同じ 4 値を投入。

---

## 4. 投入コマンド（明示承認後のみ実行）

### 4.1 対話入力（推奨）

`vercel env add` は値を引数で渡さず、対話プロンプトで入力する形式。これなら shell history に残らない。

```bash
# Production 例 (8 値すべて投入):
npx vercel env add NEXT_PUBLIC_LIFF_BOOKING_ID production
npx vercel env add NEXT_PUBLIC_LIFF_LINK_ID production
npx vercel env add LINE_LOGIN_CHANNEL_ID production
npx vercel env add LINE_CHANNEL_ACCESS_TOKEN production --sensitive
npx vercel env add LINE_CHANNEL_SECRET production --sensitive
npx vercel env add LINE_LINK_TOKEN_PEPPER production --sensitive
npx vercel env add LINE_MONTHLY_REMINDER_LIMIT production
npx vercel env add LINE_MONTHLY_REMINDER_WARN_THRESHOLD production
```

ポイント:
- `--sensitive` は token / secret / pepper に付ける（Vercel 側で値を後から表示できなくなる）。
- `NEXT_PUBLIC_LIFF_BOOKING_ID` / `NEXT_PUBLIC_LIFF_LINK_ID` / `LINE_LOGIN_CHANNEL_ID` は公開値または秘匿性低なので `--sensitive` 不要。
- **旧 `NEXT_PUBLIC_LIFF_ID` は投入しない**（コード上は deprecated fallback として残るが、本番では新名が必須）。
- Preview / Development に投入する場合は最後の引数を `preview` / `development` に差し替える。

### 4.2 ファイル経由（複数値を一度に入れたいとき）

shell history には残らないが、ファイルから読む方式。

```bash
# 注意: 一時ファイルの権限を 600 に絞ること。
umask 077
printf "%s" "<トークンを手入力>" > /tmp/line_token
npx vercel env add LINE_CHANNEL_ACCESS_TOKEN production --sensitive < /tmp/line_token
rm -f /tmp/line_token
```

- ペーストミスや一時ファイル削除忘れのリスクがあるため、慣れていない場合は対話入力（§4.1）を推奨。
- ファイル経由でも、コマンド実行後すぐに `rm -f` で消すこと。

### 4.3 Web ダッシュボードから

CLI に慣れていない場合は [https://vercel.com/miyamibus-projects/bistro-centquatre-104/settings/environment-variables](https://vercel.com/miyamibus-projects/bistro-centquatre-104/settings/environment-variables) から GUI で投入も可能。`Sensitive` チェックボックスで sensitive フラグを立てられる。

---

## 5. 投入後の確認

env の存在確認は read-only で実施。値は表示されない。

```bash
# 値は表示されない。名前と更新時刻のみ。
npx vercel env ls production | grep -E "LIFF|LINE_"
```

期待する出力（8 行が出れば OK）:

```
NEXT_PUBLIC_LIFF_BOOKING_ID             Encrypted   Production   ...
NEXT_PUBLIC_LIFF_LINK_ID                Encrypted   Production   ...
LINE_LOGIN_CHANNEL_ID                   Encrypted   Production   ...
LINE_CHANNEL_ACCESS_TOKEN               Encrypted   Production   ...
LINE_CHANNEL_SECRET                     Encrypted   Production   ...
LINE_LINK_TOKEN_PEPPER                  Encrypted   Production   ...
LINE_MONTHLY_REMINDER_LIMIT             Encrypted   Production   ...
LINE_MONTHLY_REMINDER_WARN_THRESHOLD    Encrypted   Production   ...
```

**`NEXT_PUBLIC_LIFF_ID` が表示された場合**: 旧名が残っている。削除して新名を入れること。

---

## 6. 投入後に必要なアクション

**env 変更だけでは反映されない。新規 deployment が必要。**

- Production にはデプロイ済みのコードがあるが、env を投入しただけでは古い deployment の実行環境は更新されない。
- 投入後は [line-reminder-deployment.md](line-reminder-deployment.md) の手順で新規デプロイをかける。

---

## 7. 既存 env への影響チェック

- `CRON_SECRET`（Production に既存登録）はそのまま使う。値を取得・表示・変更しない。
- `DATABASE_URL`（Production に既存登録）は触らない。本番 DB migration では `vercel env pull` 等で間接利用するが、値を出力する操作はしない（詳細は [line-reminder-db-migration.md](line-reminder-db-migration.md)）。
- 旧 `LIFF_ID`（server-only 名）が誤って残っていないか念のため確認:

```bash
npx vercel env ls production | grep -E "^LIFF_ID"
# 何も出なければ OK
```

---

## 8. 投入対象が漏れていないかの最終チェックリスト

LINE Developers Console から控えた値（[line-reminder-production-setup.md](line-reminder-production-setup.md) §6）と照合:

- [ ] LINE Developers の Provider が Login / LIFF / Messaging で同一であることを再確認
- [ ] `NEXT_PUBLIC_LIFF_BOOKING_ID` を Production + Preview + Development に投入（Booking LIFF ID）
- [ ] `NEXT_PUBLIC_LIFF_LINK_ID` を Production + Preview + Development に投入（Link LIFF ID）
- [ ] `LINE_LOGIN_CHANNEL_ID` を Production + Preview + Development に投入
- [ ] `LINE_CHANNEL_ACCESS_TOKEN` を Production + Preview + Development に投入（`--sensitive`）
- [ ] `LINE_CHANNEL_SECRET` を Production + Preview + Development に投入（`--sensitive`）
- [ ] `LINE_LINK_TOKEN_PEPPER` を Production + Preview + Development に投入（`--sensitive`、32 文字以上のランダム値）
- [ ] `LINE_MONTHLY_REMINDER_LIMIT` を Production に投入（省略時 200）
- [ ] `LINE_MONTHLY_REMINDER_WARN_THRESHOLD` を Production に投入（省略時 180）
- [ ] 旧 `NEXT_PUBLIC_LIFF_ID` を Production に入れていないことを確認
- [ ] 一時ファイル（`/tmp/line_*` 等）が残っていないことを確認
- [ ] `vercel env ls production` で 8 件が `Encrypted` 表示で並んでいることを確認
- [ ] `NEXT_PUBLIC_LIFF_BOOKING_ID` と `NEXT_PUBLIC_LIFF_LINK_ID` が異なる値になっていることを確認
- [ ] 投入した値をどこにもログ／チャット／コミットしていない

---

## 9. 禁止事項（再掲）

- `vercel env add` を明示承認なしに実行しない
- 値を表示・引用・コピー・スクショしない
- `LIFF_ID`（旧名）を投入しない。本番では `NEXT_PUBLIC_LIFF_BOOKING_ID` / `NEXT_PUBLIC_LIFF_LINK_ID` を使う
- secret を `.env.example` / `.env.local.example` に貼らない
- 「shell history に残らない」設計を破る形でコマンドを書かない

---

## 10. ユーザーへの承認依頼テンプレ

実際に投入する段階になったら、以下の承認文を提示する:

```
本番反映を許可: Vercel env preview NEXT_PUBLIC_LIFF_BOOKING_ID
本番反映を許可: Vercel env preview NEXT_PUBLIC_LIFF_LINK_ID
本番反映を許可: Vercel env preview LINE_LOGIN_CHANNEL_ID
本番反映を許可: Vercel env preview LINE_CHANNEL_ACCESS_TOKEN
本番反映を許可: Vercel env preview LINE_CHANNEL_SECRET
本番反映を許可: Vercel env preview LINE_LINK_TOKEN_PEPPER

# Preview で確認できたら次に:
本番反映を許可: Vercel env production NEXT_PUBLIC_LIFF_BOOKING_ID
本番反映を許可: Vercel env production NEXT_PUBLIC_LIFF_LINK_ID
本番反映を許可: Vercel env production LINE_LOGIN_CHANNEL_ID
本番反映を許可: Vercel env production LINE_CHANNEL_ACCESS_TOKEN
本番反映を許可: Vercel env production LINE_CHANNEL_SECRET
本番反映を許可: Vercel env production LINE_LINK_TOKEN_PEPPER
```

承認後、Claude Code は対話入力で順次投入する。
