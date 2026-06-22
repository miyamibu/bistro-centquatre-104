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

LINE Login channel 内の「LIFF」タブで、予約フォーム用と後付け連携用の **2 つの LIFF app** を作成する。どちらも同じ LINE Login channel 配下に置く。

| 項目 | 予約フォーム用 LIFF | 後付け連携用 LIFF |
|---|---|---|
| LIFF app name | `bistro-104-booking`（任意） | `bistro-104-line-link`（任意） |
| Size | **Full** | **Full** |
| Endpoint URL | `https://bistro-centquatre-104.vercel.app/booking` | `https://bistro-centquatre-104.vercel.app/line/link` |
| Scopes | `openid`, `profile` | `openid`, `profile` |
| Bot link feature | **On (Aggressive)** または **Normal** | **On (Aggressive)** または **Normal** |
| Scan QR | Off で問題なし | Off で問題なし |
| Module mode | Off | Off |

`Full` size は `liff.getIDToken()` と友だち追加導線を安定して使うため必須とする。

**控える値**

- 予約フォーム用 **LIFF ID** → 後で `NEXT_PUBLIC_LIFF_BOOKING_ID` として Vercel に投入。
- 後付け連携用 **LIFF ID** → 後で `NEXT_PUBLIC_LIFF_LINK_ID` として Vercel に投入。
- 後付け連携用 **LIFF URL**（`https://liff.line.me/<NEXT_PUBLIC_LIFF_LINK_ID>`） → 友だち追加後の電話番号通知登録導線として使う。

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

## 5. Webhook の登録（推奨）

Webhook は follow/unfollow を `LineFriend` に反映し、follow 時には電話番号によるLINE通知登録リンクを返信する。Push リマインダー自体は `Reservation.lineUserId` が保存されていれば動くが、ブロック状態の検知と事前通知登録の導線として Webhook 登録を推奨する。

電話番号登録の導線:

- follow 返信: `https://liff.line.me/<LIFF_LINK_ID>?mode=customer`
- 登録API: `/api/line/customer-link`
- 保存先: `LineCustomerLink.normalizedPhoneHash`（電話番号そのものは保存しない）
- 有効期限: `lastLinkedAt` から 180 日以内の `status = ACTIVE` のみ自動連携に使う
- 解除: 同じ登録画面で同じ電話番号を入力して解除すると `status = REVOKED` になり、自動連携対象外になる
- 予約時: 予約フォームでLINEボタンを完了していなくても、電話番号ハッシュが一意に一致し、ブロック済みでなければ `Reservation.lineUserId` を保存する

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
| 予約フォーム用 LIFF ID | `NEXT_PUBLIC_LIFF_BOOKING_ID` | 公開値（クライアントにバンドルされる） |
| 後付け連携用 LIFF ID | `NEXT_PUBLIC_LIFF_LINK_ID` | 公開値（クライアントにバンドルされる） |
| LINE Login Channel ID | `LINE_LOGIN_CHANNEL_ID` | server-only（ID token verify の `aud` 検証用） |
| Messaging API Channel access token (long-lived) | `LINE_CHANNEL_ACCESS_TOKEN` | **secret**（Push API の Bearer） |
| Messaging API Channel secret | `LINE_CHANNEL_SECRET` | **secret**（Webhook 署名検証） |
| 32 文字以上のランダム文字列 | `LINE_LINK_TOKEN_PEPPER` | **secret**（連携トークン/電話番号ハッシュ用） |

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
  - `NEXT_PUBLIC_LIFF_BOOKING_ID` / `NEXT_PUBLIC_LIFF_LINK_ID` は公開値だが、それでも公式リリース前は人目に晒さない。
- **公式アカウントの友だち上限**: フリープランは月 200 通の Push 上限。コード側で 180/200 のガードは入っているが、Console の Quota 表示も適宜確認すること。

---

## 8. 次のステップ

1. §6 のチェックリスト 4 値を手元の安全な場所にメモする（パスワードマネージャ推奨、平文ファイルや Slack に貼らない）。
2. [line-reminder-vercel-env.md](line-reminder-vercel-env.md) に進む。
3. その後 [line-reminder-db-migration.md](line-reminder-db-migration.md) → [line-reminder-deployment.md](line-reminder-deployment.md) → [line-reminder-e2e-test.md](line-reminder-e2e-test.md) の順。

---

## 7. 後付け LINE 連携トークン — 追加設定 (v2)

> 以下は `ReservationLineLinkToken` / `NotificationEvent` / `LineFriend` migration 適用後の設定。

### 7-1. 環境変数追加

| 変数名 | 内容 |
|---|---|
| `LINE_LINK_TOKEN_PEPPER` | 後付けリンクトークンのハッシュ用サーバーシークレット (32 バイト以上のランダム文字列) |

`openssl rand -base64 32` で生成し、Vercel の Environment Variables に追加すること。

### 7-2. `/line/link` ページの LIFF 設定

- LIFF アプリの「エンドポイント URL」に `https://<your-domain>/line/link` を追加する
- LIFF サイズ: Full
- スコープ: openid / profile / friend
- LINE Login channel に公式アカウントをリンク済みにする
- LINE Login / LIFF / Messaging API は同一 Provider 配下

### 7-3. Webhook

- LINE Developers Console の Webhook URL: `https://<your-domain>/api/line/webhook`
- `使用する` をオンにする
- 検証 (Verify) ボタンで 200 OK を確認する
- follow / unfollow イベントが届くことを確認する

### 7-4. accountLink (将来対応)

`accountLink` イベントの本実装は現在未対応。ログカウントのみ記録。完全実装が必要な場合は nonce 管理の追加実装が必要。
