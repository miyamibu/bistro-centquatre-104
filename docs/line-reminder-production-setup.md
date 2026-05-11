# LINE前日リマインド: LINE Developers Console 本番設定手順

本番ドメイン: `https://bistro-centquatre-104.vercel.app`（Vercel プロジェクト名 `bistro-centquatre-104` で確認済み。実ドメインが別の場合は本番ドメインに読み替えること）

このドキュメントは LINE Developers Console 側で行う手作業のみを扱う。コード変更や Vercel/DB 変更は別ドキュメントに分けてある。

- Vercel 環境変数: [line-reminder-vercel-env.md](line-reminder-vercel-env.md)
- 本番 DB migration: [line-reminder-db-migration.md](line-reminder-db-migration.md)
- 本番デプロイ: [line-reminder-deployment.md](line-reminder-deployment.md)
- LINE 実機テスト: [line-reminder-e2e-test.md](line-reminder-e2e-test.md)

---

## 0. 最重要前提（絶対に守る）

**LINE Login channel / LIFF app / Messaging API channel は、必ず同一 LINE Developers Provider 配下で作成すること。**

- 別 Provider だと userId の発行軸が変わり、ID token の `sub` を Messaging API Push の宛先 `userId` として使えなくなる。
- この不整合はコード側で検出不能（Push API が静かに 4xx を返すだけ）。
- すでに別 Provider 配下に作ってしまっている場合は、同一 Provider に作り直す。

---

## 1. Provider の用意

1. [https://developers.line.biz/console/](https://developers.line.biz/console/) にログイン。
2. 既存 Provider があればそれを流用。なければ「Create a new provider」で 1 つ作成。
3. **以降の 3 チャネルはすべてこの Provider 配下に作る。**

---

## 2. LINE Login channel の作成

| 項目 | 値 |
|---|---|
| Channel type | LINE Login |
| Provider | §1 で決めた Provider |
| Region | Japan |
| App types | Web app |
| Email address | 店舗連絡用メール |

**Channel settings**

- **Scopes**: `openid` と `profile` を有効化（両方必須）。
  - `openid` がないと ID token が発行されない。
  - `profile` がないと友だちステータス確認系の API が期待通り動かない場合がある。
- **Callback URL**: LIFF を使うので不要。空でよい（後段で LIFF 経由ログインが走る）。
- **LINE Official Account をリンクする**: Linked OA セクションで、§4 で作る Messaging API の公式アカウントをリンクする（Messaging API channel 作成後に戻ってきて設定）。

**控える値**

- **Channel ID** → 後で `LINE_LOGIN_CHANNEL_ID` として Vercel に投入。
- Channel secret は今回のコード経路では使わない（控えるだけでよい）。

---

## 3. LIFF app の作成

LINE Login channel 内の「LIFF」タブで作成する。

| 項目 | 値 |
|---|---|
| LIFF app name | `bistro-104-reservation`（任意） |
| Size | **Full**（requestFriendship 等を確実に動かすため必須） |
| Endpoint URL | `https://bistro-centquatre-104.vercel.app/booking` |
| Scopes | `openid`, `profile` |
| Bot link feature | **On (Aggressive)** または **Normal**（友だち追加同線を出すため On 推奨） |
| Scan QR | Off で問題なし |
| Module mode | Off |

**控える値**

- **LIFF ID**（`xxxxxxxx-xxxxxxxx` 形式） → 後で `NEXT_PUBLIC_LIFF_ID` として Vercel に投入。
- **LIFF URL**（`https://liff.line.me/<LIFF_ID>`） → QR コード配布や、メールテンプレ等で予約導線として使える。

---

## 4. Messaging API channel の作成

| 項目 | 値 |
|---|---|
| Channel type | Messaging API |
| Provider | §1 で決めた Provider（**Login と必ず同一**） |
| Region | Japan |
| Company / store name | bistro centquatre 104 |
| Email address | 店舗連絡用メール |

**Channel settings**

- **Use webhook**: §5 で設定。
- **Auto-reply messages**: Off（リマインダー以外で勝手に話さない）。
- **Greeting messages**: 任意（公式アカウント友だち追加時に挨拶を出すならここ）。

**Channel access token の発行**

- 「Messaging API」タブ → 「Channel access token」セクションで **Long-lived token** を発行。
- 既存トークンを差し替えると過去発行の token は無効化される点に注意。

**控える値**

- **Channel access token（long-lived）** → 後で `LINE_CHANNEL_ACCESS_TOKEN` として Vercel に投入。
- **Channel secret** → 「Basic settings」タブにある値。後で `LINE_CHANNEL_SECRET` として Vercel に投入。

**公式アカウントの設定**

- 「Messaging API」タブから「LINE Official Account Manager」へ移動。
- 「応答設定」で:
  - 応答メッセージ: **オフ**
  - あいさつメッセージ: 任意
  - Webhook: **オン**（§5 で URL を入れる）
- LINE Login channel に戻って「Linked OA」にこの公式アカウントを紐づける（§2 の最後の作業）。

---

## 5. Webhook の登録（任意・推奨）

MVP 実装では Webhook は受信して 200 を返すのみで、follow/unfollow の DB 反映はしない。Push リマインダー自体は Webhook 未登録でも動く。

ただし、登録しておくと将来:
- ブロック / 友だち解除を検知して `lineUserId` を自動クリアできる
- イベントログを残せる

設定する場合:

| 項目 | 値 |
|---|---|
| Webhook URL | `https://bistro-centquatre-104.vercel.app/api/line/webhook` |
| Use webhook | On |
| Webhook redelivery | On 推奨 |

「Verify」ボタンを押すと、現状 `LINE_CHANNEL_SECRET` が Vercel に投入済かつ最新コードがデプロイ済みなら 200 が返るはず。未デプロイなら一旦 Verify はスキップしてよい（後でも検証できる）。

---

## 6. 取得した値のチェックリスト

すべて揃ったら、次のフェーズ（[line-reminder-vercel-env.md](line-reminder-vercel-env.md)）で Vercel に投入する。

| LINE Developers で控えた値 | Vercel 環境変数名 | 性質 |
|---|---|---|
| LIFF ID | `NEXT_PUBLIC_LIFF_ID` | 公開値（クライアントにバンドルされる） |
| LINE Login Channel ID | `LINE_LOGIN_CHANNEL_ID` | server-only（ID token verify の `aud` 検証用） |
| Messaging API Channel access token (long-lived) | `LINE_CHANNEL_ACCESS_TOKEN` | **secret**（Push API の Bearer） |
| Messaging API Channel secret | `LINE_CHANNEL_SECRET` | **secret**（Webhook 署名検証） |

---

## 7. 注意・落とし穴

- **Provider をまたぐと userId が一致しない**: 同一 Provider 確認は LINE Developers Console の URL（`/console/provider/<providerId>/...`）でも目視確認できる。Login / LIFF / Messaging で同じ `providerId` が URL に出ているか確認する。
- **Long-lived token は再発行で旧 token が即無効化**: Vercel に投入する前にトークンが他の用途で使われていないか確認。
- **LIFF size を Compact / Tall にすると `liff.requestFriendship()` が正しく動かない場合がある**: 必ず **Full**。
- **scope に `openid` を含まないと `liff.getIDToken()` が `null` を返す**: 既存のチャネルを流用する場合は scope を再確認。
- **本ドキュメントで取得した値をチャット・ログ・コミット・スクショに貼らない**:
  - `LINE_CHANNEL_ACCESS_TOKEN` は実質 API キー。
  - `LINE_CHANNEL_SECRET` は Webhook 署名の HMAC 鍵。
  - `LINE_LOGIN_CHANNEL_ID` は秘匿性は低いが server env として扱う。
  - `NEXT_PUBLIC_LIFF_ID` は公開値だが、それでも公式リリース前は人目に晒さない。
- **公式アカウントの友だち上限**: フリープランは月 200 通の Push 上限。コード側で 180/200 のガードは入っているが、Console の Quota 表示も適宜確認すること。

---

## 8. 次のステップ

1. §6 のチェックリスト 4 値を手元の安全な場所にメモする（パスワードマネージャ推奨、平文ファイルや Slack に貼らない）。
2. [line-reminder-vercel-env.md](line-reminder-vercel-env.md) に進む。
3. その後 [line-reminder-db-migration.md](line-reminder-db-migration.md) → [line-reminder-deployment.md](line-reminder-deployment.md) → [line-reminder-e2e-test.md](line-reminder-e2e-test.md) の順。
