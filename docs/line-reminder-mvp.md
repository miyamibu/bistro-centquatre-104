# bistro-reservation: LINE前日リマインドMVP実装指示

## 目的

bistro centquatre 104 の予約サイトに、LINE公式アカウントを使った「予約前日リマインド通知」をMVPとして実装する。

この実装では、クライアントから `lineUserId` を直接受け取って保存してはいけない。LIFFで取得した `lineIdToken` をサーバーに送り、サーバー側でLINE LoginのID token verify endpointを使って検証し、verify結果の `sub` を `Reservation.lineUserId` として保存する。

## 最重要前提

LINE Login チャネル / LIFF アプリ / Messaging API チャネルは、必ず同一の LINE Developers Provider 配下で作成する。

別Providerだと userId の発行軸が変わり、ID token の `sub` を Push API の宛先として使えなくなる。この前提はコードでは完全には検証できないため、実装コメントまたはdocs/.env説明にも明記する。

## 実装方針

MVPでは通知台帳テーブルは作らず、`Reservation` に3カラムを追加する。

```prisma
lineReminderSentAt DateTime?
lineReminderStatus String?
lineReminderError  String?
```

既存の `Reservation.lineUserId String?` は維持する。存在しない場合のみ追加する。重複追加はしない。

`NotificationEvent` テーブルは今回作らない。後で昇格可能なように、LINE送信処理は `src/lib/line.ts` に切り出す。

## 作業前に読むファイル

まず以下を読んで、既存の構造・命名・認証・テスト方針を把握する。

```text
prisma/schema.prisma
src/lib/env.ts
src/lib/env-public.ts
src/lib/prisma.ts
src/lib/dates.ts
src/lib/reservation-config.ts
src/lib/reservation-copy.ts
src/lib/email.ts
src/components/reserve-form.tsx
src/app/api/reservations/route.ts
src/app/api/crons/remind/route.ts
src/app/api/cron/remind/route.ts
src/app/api/crons/cancel-expired-orders/route.ts
src/app/api/crons/delete-old-histories/route.ts
src/lib/validation/reservations.ts
vercel.json
package.json
tests/cron-auth.test.ts
tests/reservations-route.test.ts
tests/reservations-route-db.test.ts
tests/env-validation.test.ts
```

最初に短い実装計画を出してから編集を始める。ただし、以下の仕様は固定であり、勝手に大きく変更しない。

## 1. 環境変数

追加・変更するenv

```env
NEXT_PUBLIC_LIFF_ID=...          # フロントの liff.init で使う。公開値。旧 LIFF_ID から改名。
LINE_LOGIN_CHANNEL_ID=...        # ID token verify の client_id。新規。
LINE_CHANNEL_ACCESS_TOKEN=...    # Messaging API push 用。既存。
LINE_CHANNEL_SECRET=...          # Webhook署名検証用。既存。
```

対応ファイル

```text
src/lib/env.ts
src/lib/env-public.ts
.env.example
.env.local.example
```

要件

- 既存の `LIFF_ID` は `NEXT_PUBLIC_LIFF_ID` に移行する。
- `LINE_LOGIN_CHANNEL_ID` を追加する。
- `NEXT_PUBLIC_LIFF_ID` はフロントで参照できる形にする。
- server-only secret と public env を混同しない。
- `.env.local` は編集しない。
- env値やtokenをログ出力しない。
- `hasLineMessagingEnv()` は既存利用箇所を確認した上で、Push送信に必要な `LINE_CHANNEL_ACCESS_TOKEN` を正しく判定する。
- 必要なら以下のような補助関数を追加する。

```ts
hasLineMessagingEnv()
hasLineLoginEnv()
hasLineWebhookEnv()
getLineLoginChannelId()
getLineChannelAccessToken()
getLineChannelSecret()
```

命名は既存の `env.ts` のスタイルに合わせる。

## 2. Prisma schema / migration

対応ファイル

```text
prisma/schema.prisma
prisma/migrations/**
```

要件

`Reservation` に以下を追加する。

```prisma
lineReminderSentAt DateTime?
lineReminderStatus String?
lineReminderError  String?
```

既存の `lineUserId String?` があれば維持する。なければ追加する。

migrationを作成する。ローカルDB接続が可能なら以下を使う。

```bash
npx prisma migrate dev --name add_line_reminder_fields
```

DB接続ができない場合は、Prisma schemaを更新し、migration SQLを手書きで作る。ただし破壊的変更は禁止。

実行可能なら最後に以下を実行する。

```bash
npx prisma generate
```

## 3. LINE helper を作る

新規推奨ファイル

```text
src/lib/line.ts
```

### 実装する関数

#### `verifyLineIdToken(lineIdToken: string): Promise<string | null>`

LINE LoginのID token verify endpointにPOSTする。

```text
POST https://api.line.me/oauth2/v2.1/verify
Content-Type: application/x-www-form-urlencoded

id_token=<lineIdToken>
client_id=<LINE_LOGIN_CHANNEL_ID>
```

レスポンスの検証条件:

- `iss === "https://access.line.me"`
- `aud === LINE_LOGIN_CHANNEL_ID`
- `sub` が `U[0-9a-f]{32}` に一致
- `exp` が過去でないこと。verify endpoint側で検証されるはずだが、レスポンス値があれば確認する。

成功時は `sub` を返す。失敗時は `null` を返す。

重要:

- ID tokenをDB保存しない。
- ID tokenをログに出さない。
- invalid tokenで予約作成全体を失敗させない。LINE通知だけ無効化して予約は続行する。
- ただし、既存バリデーション方針と衝突する場合は、影響が小さい方を選ぶ。

#### `canPushToLineUser(lineUserId: string): Promise<boolean>`

可能ならMessaging APIのGet profile endpointで宛先妥当性を確認する。

```text
GET https://api.line.me/v2/bot/profile/{lineUserId}
Authorization: Bearer <LINE_CHANNEL_ACCESS_TOKEN>
```

200なら `true`。404/403/その他は `false`。このチェックはPushできない宛先を保存しないための補助。`LINE_CHANNEL_ACCESS_TOKEN` が未設定なら `false`。

#### `pushLineTextMessage(args): Promise<{ ok: boolean; error?: string; requestId?: string }>`

Push APIを使ってテキストを送信する。

```text
POST https://api.line.me/v2/bot/message/push
Authorization: Bearer <LINE_CHANNEL_ACCESS_TOKEN>
Content-Type: application/json
X-Line-Retry-Key: <uuid>
```

要件:

- 一度のPushはテキスト1通でよい。
- `X-Line-Retry-Key` を使う。
- retry key はUUID形式にする。
- `reservation.id + targetDate` などから決定的に生成してよいが、LINE側のretry key有効期間は24時間なので、24時間を超えて同じretry keyを使い続けない設計にする。
- 409は「すでに受理済み」とみなして成功扱いにしてよい。
- 429や4xx/5xxは失敗扱い。
- エラー文はDB保存前に短く丸める。tokenや個人情報を含めない。

#### `getLineMonthlyQuotaConsumption(): Promise<number | null>`

補助用途。以下を叩く。

```text
GET https://api.line.me/v2/bot/message/quota/consumption
Authorization: Bearer <LINE_CHANNEL_ACCESS_TOKEN>
```

MVPでは月初のログ出力用。このAPIの値はLINE Official Account Managerからの手動配信も含むが、概算値なのでDBガードの主判定には使わない。

## 4. 予約フォームにLIFF導線を追加

対応ファイル

```text
src/components/reserve-form.tsx
package.json
package-lock.json
```

### 依存追加

既存package managerに合わせて `@line/liff` を追加する。

```bash
npm install @line/liff
```

lockfileも更新する。

### UI要件

予約フォーム内に任意の導線を追加する。

表示例:

```text
LINEで前日通知を受け取る
```

通常予約はLINE連携なしでも完了できる。LINE連携の失敗で予約フォーム全体を壊さない。

### LIFF flow

以下の順で実装する。

```text
liff.init
→ liff.login
→ liff.requestFriendship()
→ liff.getFriendship() で friendFlag === true を確認
→ liff.getIDToken() を取得
→ submit時に lineIdToken として /api/reservations へ送る
```

### 重要条件

- `liff.getProfile().userId` をサーバーに送ってはいけない。
- hidden fieldに `lineUserId` を入れてはいけない。
- サーバーへ送るのは `lineIdToken` のみ。
- `lineIdToken` は予約送信時だけ使う。localStorage等に保存しない。
- `NEXT_PUBLIC_LIFF_ID` がない場合はLINE通知ボタンを非表示またはdisabledにする。
- `liff.requestFriendship()` が使えない環境では、エラーメッセージを出して通常予約は続行可能にする。
- LINE連携済みの場合、フォーム上に「LINE前日通知を受け取ります」のように表示する。
- `friendFlag !== true` の場合は `lineIdToken` を送らない。

### LINE Developers 側の前提としてdocsまたはコメントに残す内容

```text
- LINE Login channel scope: openid + profile
- LIFF size: Full
- LINE Login channel に公式アカウントをリンク済みにする
- LINE Login / LIFF / Messaging API は同一Provider配下
```

## 5. `/api/reservations` を lineIdToken 方式に変更

対応ファイル

```text
src/app/api/reservations/route.ts
src/lib/validation/reservations.ts
```

必要に応じて関連テストも更新する。

### 要件

- request bodyの任意項目として `lineIdToken?: string` を受け取る。
- `lineUserId` をクライアントから受け取る仕様は廃止する。
- 既存クライアント互換で `lineUserId` が来ても信用せず、保存に使わない。
- `lineIdToken` がある場合:
  1. `verifyLineIdToken(lineIdToken)` を呼ぶ
  2. `sub` を得る
  3. 可能なら `canPushToLineUser(sub)` で友だち追加/Push可能性を確認
  4. OKなら `Reservation.lineUserId` に保存
  5. NGなら `lineUserId: null` で予約は続行
- LINE検証失敗で予約作成全体を落とさない。
- ただし既存の予約バリデーション、空席判定、rate limit、CSRF/CORS防御、transaction、duplicate検知は絶対に壊さない。
- ID tokenやLINE access tokenをログに出さない。

### APIレスポンス

既存レスポンスを壊さない。可能なら以下のような追加情報を返してもよい。

```ts
lineNotification?: {
  enabled: boolean
}
```

ただし既存UI/テストへの影響が大きければ追加しない。

## 6. `/api/crons/remind` にLINE Push送信を実装

対応ファイル

```text
src/app/api/crons/remind/route.ts
```

`src/app/api/cron/remind/route.ts` が alias なら、既存挙動を壊さない。本体実装は `/api/crons/remind` に寄せる。

### 対象予約

既存の「翌日予約取得」ロジックがあるならそれを活かす。対象条件は以下。

```ts
status: "CONFIRMED"
lineUserId != null
lineReminderSentAt == null
予約日がJSTで翌日
```

### 送信内容

1予約につき1通。

文面例:

```text
【bistro centquatre 104】ご予約前日のお知らせ

明日 {date} {time}、{partySize}名様でご予約を承っています。
ご変更・キャンセルはお電話でご連絡ください。
```

注意:

- 電話番号、アレルギー、要望、管理メモなどはLINE本文に入れない。
- 顧客名を入れるかどうかは既存の文体に合わせる。迷ったら名前は入れず、日時・人数だけにする。

### 200通ガード

MVPではDB countで制御する。

当月JSTの `Reservation.lineReminderSentAt` count を数える。

```text
180以上: warning log
200以上: 送信停止
```

送信ループ中も送信数をインクリメントして、200に達したら残りは送らない。

`lineReminderStatus` は以下のような値を使う。

```text
SENT
FAILED
SKIPPED_QUOTA
```

成功時:

```ts
lineReminderSentAt = now
lineReminderStatus = "SENT"
lineReminderError = null
```

失敗時:

```ts
lineReminderStatus = "FAILED"
lineReminderError = 短く丸めたエラー
```

quota停止時:

```ts
lineReminderStatus = "SKIPPED_QUOTA"
lineReminderError = "LINE monthly free quota guard reached"
```

ただし、`lineReminderSentAt` は成功時以外に入れない。

### quota consumption API

月初JST、つまり `day === 1` のcron実行時だけ、可能なら以下を呼んでログに出す。

```text
GET /v2/bot/message/quota/consumption
```

これはOfficial Account Managerからの手動配信も含む概算値なので、主判定には使わない。

### 送信方式

- `Promise.all` 一括送信は禁止。
- 逐次送信、または小さいbatchで送る。
- MVPでは逐次送信でよい。
- 1件ごとに成功/失敗をDBに反映する。
- 送信失敗でcron全体を即死させない。
- 最後にsummary JSONを返す。

レスポンス例:

```json
{
  "ok": true,
  "targetDate": "2026-05-12",
  "totalCandidates": 3,
  "sent": 2,
  "failed": 1,
  "skippedQuota": 0,
  "monthlySentBefore": 42
}
```

### 認証

既存のcron認証を維持する。`CRON_SECRET` / Bearer認証があるなら絶対に外さない。

## 7. LINE webhook MVPを作る

新規ファイル

```text
src/app/api/line/webhook/route.ts
```

### 要件

```text
POST /api/line/webhook
```

- raw bodyを読む。
- `x-line-signature` を取得する。
- `LINE_CHANNEL_SECRET` で HMAC-SHA256 を計算し、base64 digestを比較する。
- 比較は `timingSafeEqual` を使う。
- 署名NGなら 401。
- 署名OKなら 200 を返す。
- follow/unfollow のDB書き込みは今回しない。
- body parseは署名検証後に行う。
- ID token、access token、署名secretをログ出力しない。

レスポンス例:

```json
{ "ok": true }
```

LINE Developers ConsoleでWebhook URLを登録するかは任意。登録するならこの最小受信実装を置く。

## 8. vercel.json にcronを追加

対応ファイル

```text
vercel.json
```

### 要件

既存cronを維持し、重複がなければ以下を追加する。

```json
{
  "path": "/api/crons/remind",
  "schedule": "0 1 * * *"
}
```

これはUTC 01:00、JST 10:00狙い。

注意:

- cron個数のために統合する必要はない。
- Vercel Hobbyの商用利用制限はコード実装とは別論点。今回のコード変更では判断しない。
- 既存cronを削除しない。

## 9. テスト追加・更新

既存のVitest構成に合わせて、可能な範囲でテストを追加・更新する。

最低限ほしいテスト:

### LINE helper

- `verifyLineIdToken` が `sub` を返す。
- `aud` が `LINE_LOGIN_CHANNEL_ID` と違う場合は `null`。
- `iss` が違う場合は `null`。
- `sub` が `U[0-9a-f]{32}` でない場合は `null`。
- tokenやsecretをログに出さない。

### reservations route

- request bodyに `lineUserId` が来ても保存に使わない。
- `lineIdToken` がverify成功した場合だけ `Reservation.lineUserId` に保存する。
- LINE verify失敗でも通常予約は作成できる。

### webhook route

- 正しい署名なら200。
- 不正署名なら401。
- `LINE_CHANNEL_SECRET` 未設定時の挙動が既存env方針と整合している。

### cron remind

- `lineReminderSentAt != null` の予約は送らない。
- 当月DB countが200以上なら送らない。
- 成功時に `lineReminderSentAt` と `lineReminderStatus="SENT"` が入る。
- 失敗時に `lineReminderStatus="FAILED"` と `lineReminderError` が入る。

外部APIは `global.fetch` mockでよい。実LINE APIにはテストで接続しない。

## 10. 禁止事項

以下は禁止。

```text
- クライアントから lineUserId を直接保存する
- liff.getProfile().userId をサーバーへ送る
- ID tokenをDB保存する
- LINE token / secret / ID token / x-line-signature をログ出力する
- LINE通知失敗で予約作成全体を失敗させる
- Promise.allで全予約へ一括Pushする
- 既存の予約競合制御、空席判定、rate limit、cron認証を壊す
- .env.local を編集する
- 既存cronを削除する
- NotificationEvent テーブルを今回新設する
- SMSやメール代替を今回実装する
- unrelatedなオンラインストア/order系コードを変更する
```

## 11. 実行コマンド

実装後、可能な限り以下を実行する。

```bash
npm install
npx prisma generate
npm run lint
npm test
npm run build
```

migration作成が必要なら:

```bash
npx prisma migrate dev --name add_line_reminder_fields
```

ローカルDBがなくてmigration実行できない場合は、その理由を最終報告に明記する。

## 12. 最終報告フォーマット

最後に以下を報告する。

```text
## 変更ファイル
- ...

## 実装内容
- ...

## セキュリティ上の確認
- クライアント lineUserId を信用していない
- ID token は保存していない
- Webhook署名検証あり
- Cron認証維持

## 実行した検証
- npm run lint: pass/fail
- npm test: pass/fail
- npm run build: pass/fail
- prisma generate: pass/fail

## 未実施・注意点
- LINE Developers側で同一Provider確認が必要
- LINE Login scope: openid + profile
- LIFF size: Full
- 公式アカウントリンク設定が必要
- Vercel Hobby商用利用制限はコード外の判断
```

実装を開始してください。
