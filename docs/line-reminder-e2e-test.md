# LINE前日リマインド: 本番 E2E 実機テスト手順

このドキュメントは、本番反映（LINE Developers 設定・Vercel env・DB migration・コードデプロイ）が完了した後、本番環境で行う実機エンドツーエンドテストの手順をまとめる。

- 前段: [line-reminder-production-setup.md](line-reminder-production-setup.md) → [line-reminder-vercel-env.md](line-reminder-vercel-env.md) → [line-reminder-db-migration.md](line-reminder-db-migration.md) → [line-reminder-deployment.md](line-reminder-deployment.md)

---

## 0. 安全原則（絶対遵守）

- 実機テストは**自分の LINE アカウント**でのみ行う。他人の LINE アカウントや顧客に対して動作確認しない。
- `<CRON_SECRET>` / `<本番ドメイン>` / `<reservationId>` / `<lineUserId>` 等の placeholder を docs では使う。実値をチャット・ログ・スクショに貼らない。
- DB 接続を伴う read-only 確認 / curl による cron 実行 / Vercel 操作は **Phase 7 以降の明示承認後にのみ実行**する。本ドキュメントは手順書であり、実行は別タスク扱い。
- LINE 公式アカウントの月 200 通フリー枠を消費する。テスト送信回数を最小限にする。
- 本番予約は本物の店舗運営に流れる。テスト予約は管理画面から確実にキャンセル / 削除する運用を別途決めておく。

---

## 1. テスト前提（これが揃っていないと実機テスト不能）

以下が **全て** 完了していることを着手前に確認する。1 つでも欠けていたら戻る。

- [ ] LINE Login channel / LIFF app / Messaging API channel が**同一 LINE Developers Provider** 配下で作成済
- [ ] LIFF の scope に `openid` と `profile` が含まれている
- [ ] LIFF size が **Full**
- [ ] LINE Login channel に公式アカウントが「Linked OA」として紐づけ済
- [ ] Vercel Production env に LINE 4 値が投入済
  - `NEXT_PUBLIC_LIFF_ID`
  - `LINE_LOGIN_CHANNEL_ID`
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_CHANNEL_SECRET`
- [ ] 既存の `CRON_SECRET` が Production env に存在する（流用）
- [ ] 本番 DB に `20260511120000_add_line_reminder_fields` migration が適用済
- [ ] 新コード（LINE MVP）が本番にデプロイ済
- [ ] `https://<本番ドメイン>/booking` が 200 で表示できる
- [ ] テスト用に手元の LINE アプリで公式アカウントをブロックしていない（ブロック中は Push が届かない）

---

## 2. テスト予約の条件

`/api/crons/remind` は **JST で翌日** の `CONFIRMED` 予約だけを対象にする。

```text
例: 今日が 2026-05-11（JST）なら、テスト予約は 2026-05-12 の日付で作成する。
```

注意:

- 予約日が今日や過去だと cron 対象外（`targetDate` と一致しない）→ `totalCandidates: 0`。
- 予約日が翌日でも status が `CANCELLED` / `DONE` / `NOSHOW` だと対象外。
- 予約日が翌日でも `lineUserId` が null（LIFF 連携しなかった予約）は対象外。
- 同じ予約に対して二重送信しない仕様（`lineReminderSentAt IS NULL` のみ抽出）。再テストする場合は**新しいテスト予約を別途作成する**のが原則。

---

## 3. LIFF 連携テスト（スマホ実機での流れ）

LIFF は LINE アプリ内ブラウザでの動作を前提としている。デスクトップブラウザだと `liff.login` のリダイレクトや `requestFriendship` が期待通り動かない場合がある。**必ず手元のスマホの LINE アプリ**で動作確認する。

```text
1. スマホで LINE にログイン済の状態にする
2. LINE アプリ内ブラウザで https://<本番ドメイン>/booking を開く
   - LINE トーク画面に URL を貼って自分宛に送信 → タップで開くのが楽
   - もしくは LIFF URL https://liff.line.me/<LIFF_ID> を開けば LIFF アプリ枠で表示される
3. 予約フォームの「予約」ボタンの左に「LINE」ボタンが描画されることを確認
4. 「LINE」ボタンをタップ
5. LIFF が初期化され、必要なら LINE ログイン画面に遷移
6. ログイン後、公式アカウントを友だち追加するプロンプトが出れば追加（ブロック中なら解除）
7. フォームに戻って、ボタン横の説明 / ボタン文言が「LINE連携済み」「連携済」に切り替わっていることを確認
8. 予約日を「明日」に設定して、その他の必須項目（時間帯、人数、コース、氏名、電話番号）を入力
9. 「予約」ボタンを押して送信
10. 予約完了表示（`<日付> <ランチ/ディナー> N名で承りました。`）を確認
```

注意点:

- 友だち追加せず断ると `friendFlag !== true` となり、`lineIdToken` はサーバーへ送られない。予約自体は成功するが LINE 通知の対象にはならない（仕様通り）。
- LIFF 連携の途中で失敗してもフォームエラーは赤字で出るのみで、通常予約は続行可能。
- `liff.getProfile().userId` は使わない設計。サーバーは `lineIdToken` のみを信用する。

---

## 4. 予約作成後の DB / 管理画面確認

DB 接続を伴う read-only 確認は **Phase 7 以降の明示承認後にのみ実行**。本セクションは手順記述のみ。

### 4.1 期待値

LIFF 連携あり予約の場合:

- `Reservation.lineUserId` が **null でない**（`U` + 32文字の hex）
- `Reservation.lineReminderSentAt` は **null**（まだ送っていない）
- `Reservation.lineReminderStatus` は **null**
- `Reservation.lineReminderError` は **null**

LIFF 連携なし予約の場合:

- `Reservation.lineUserId` は **null**
- その他の `lineReminder*` も null

### 4.2 確認方法（承認後のみ実行）

優先順:

1. **管理画面 `/admin/reservations`**: 管理画面上で当該予約が `CONFIRMED` で作成されていることを目視確認。`lineUserId` まで管理画面に出ているかは画面実装次第（出ていない場合は §4.2.2 へ）。
2. **Supabase Dashboard の Table editor**（read-only モード推奨）:
   ```sql
   -- 明示承認後のみ
   SELECT id, date, "servicePeriod", "partySize", status,
          "lineUserId" IS NOT NULL AS has_line,
          "lineReminderSentAt", "lineReminderStatus"
     FROM "Reservation"
    WHERE date = '<明日のYYYY-MM-DD>'
    ORDER BY "createdAt" DESC
    LIMIT 5;
   ```
   - `lineUserId` の実値はメモしない。`IS NOT NULL` で boolean だけ確認するのが安全。
3. **Vercel CLI で DATABASE_URL を子プロセスにだけ渡す方式**（[line-reminder-db-migration.md](line-reminder-db-migration.md) §6.1 参照）。

### 4.3 DB を見ない場合の代替

DB を直接見られない場合は、§5 の cron 手動実行で得られる summary JSON の `totalCandidates` で間接確認できる:

- 明日日付・LIFF 連携あり・status=CONFIRMED の予約が 1 件あれば `totalCandidates >= 1` になる。
- `totalCandidates: 0` なら何かが嚙み合っていない（日付ズレ、`lineUserId` 未保存、status 違い、等）。

---

## 5. 手動 cron 実行

**Phase 7 以降の明示承認後にのみ実行**。本セクションは手順記述のみ。

### 5.1 注意事項

- `<CRON_SECRET>` の実値はチャット・ログ・PR・スクショに貼らない。
- 引数に直接書くと shell history に残るため、環境変数経由で渡す（§5.3）。
- 1 度実行すると当該 LINE userId に対して実際にトークが送信される。**自分の LINE アカウント宛**でのみ実行する。

### 5.2 シンプルな例（history に残るため非推奨）

```bash
# 非推奨: secret が shell history に残る
curl -i -X POST "https://<本番ドメイン>/api/crons/remind" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

### 5.3 推奨: 環境変数経由（history に残らない）

```bash
# 対話入力。エコー無効で secret を読み込む。
read -s CRON_SECRET_VALUE
echo
curl -i -X POST "https://<本番ドメイン>/api/crons/remind" \
  -H "Authorization: Bearer ${CRON_SECRET_VALUE}"
unset CRON_SECRET_VALUE
```

- `read -s` でタイプ中に画面に表示されない。
- `unset` で実行後すぐに環境から消す。
- `curl` の `-i` で HTTP ステータスとヘッダも表示。`-v` は使わない（リクエストヘッダに `Authorization: Bearer <値>` が出てしまうため）。

### 5.4 期待される HTTP ステータス

- `200 OK`: 認証成功、cron 実行成功
- `401 Unauthorized`: `CRON_SECRET` 不一致 or ヘッダ未付与
- `503`: `RESERVATION_SCHEMA_NOT_READY`（migration 未適用）
- `500`: その他の cron 実行失敗

---

## 6. 期待 summary JSON

`/api/crons/remind` 成功時のレスポンス（[src/app/api/crons/remind/route.ts](../src/app/api/crons/remind/route.ts) 実装ベース）:

```json
{
  "ok": true,
  "targetDate": "YYYY-MM-DD",
  "totalCandidates": 1,
  "sent": 1,
  "failed": 0,
  "skippedQuota": 0,
  "monthlySentBefore": 0
}
```

LINE env が未投入だった場合の short-circuit レスポンス:

```json
{
  "status": "SKIPPED_LINE_SETUP",
  "date": "YYYY-MM-DD",
  "count": 0
}
```

判定基準:

| フィールド | 期待値 | 説明 |
|---|---|---|
| `ok` | `true` | cron 実行に到達 |
| `targetDate` | 明日 (JST) | 例: `2026-05-12` |
| `totalCandidates` | テスト予約件数（通常 1） | LIFF 連携あり・status=CONFIRMED・明日日付・`lineReminderSentAt IS NULL` の予約数 |
| `sent` | テスト予約と同数 | 正常に LINE Push が成功した数 |
| `failed` | 0 | 失敗時は本番テストでは戻って原因を切り分ける |
| `skippedQuota` | 0 | 月 200 通到達時のみ増える |
| `monthlySentBefore` | 当月 JST の送信済件数 | 0〜199 の範囲 |

---

## 7. LINE 到達確認

期待される実機メッセージ（[src/lib/line.ts](../src/lib/line.ts) `buildReminderText` ベース）:

```text
【bistro centquatre 104】ご予約前日のお知らせ

明日 YYYY-MM-DD HH:mm、N名様でご予約を承っています。
ご変更・キャンセルはお電話でご連絡ください。
```

確認観点:

- [ ] 公式アカウント名義で届く
- [ ] 店名「bistro centquatre 104」が含まれている
- [ ] 日付・時間・人数が予約と一致
- [ ] **電話番号・要望・アレルギー詳細・管理メモ・顧客名は含まれていない**（PII 漏洩防止）
- [ ] リンクや絵文字スタンプは含まれない（プレーンテキストのみ）

---

## 8. 送信後 DB 確認

**Phase 7 以降の明示承認後にのみ実行**。

期待値（送信成功時）:

- `lineReminderSentAt`: 送信時刻（UTC TIMESTAMP(3)）
- `lineReminderStatus`: `"SENT"`
- `lineReminderError`: `null`

確認 SQL（明示承認後のみ実行、`<reservationId>` を実 ID に置換）:

```sql
SELECT id,
       "lineReminderSentAt",
       "lineReminderStatus",
       "lineReminderError"
  FROM "Reservation"
 WHERE id = '<reservationId>';
```

失敗時は `lineReminderStatus = "FAILED"` / `lineReminderError = <短く丸めたエラー>`、`lineReminderSentAt` は **更新されない**（次回 cron で再送候補に残る）。

quota 上限ヒット時は `lineReminderStatus = "SKIPPED_QUOTA"` / `lineReminderError = "LINE monthly free quota guard reached"`、`lineReminderSentAt` は更新されない。

---

## 9. 二重送信防止確認

同じ予約に対して二重に Push されないことを確認する。

```text
1. §5 の cron 手動実行を 1 度成功させる
2. summary が { sent: 1, ... } になることを確認
3. 同じ予約状態のまま、§5 をもう一度実行する
4. summary が { sent: 0, totalCandidates: 0, ... } になることを確認
   （lineReminderSentAt が埋まったため抽出対象から除外される）
```

注意:

- LINE 無料枠を消費し得る。3 回目以降は実行しない。
- 別予約を追加して同じ cron を呼び直す形での回帰確認なら影響は最小限。
- `failed` だった予約は `lineReminderSentAt` が null のままなので**自動的に翌日 cron で再送される**。これがテスト中に走ると LINE に追加で届く点に注意。

---

## 10. quota guard 確認方針

200 通ガード（180 で warn、200 で SKIPPED_QUOTA）は **コードレビューとユニットテストで確認済み**として扱う。本番で 200 件の予約を作って実機テストは**しない**（ユーザーへの誤通知・店舗運営影響が大きいため）。

- 180 件以上: `crons.remind.quota_warning` ログが出る
- 200 件以上: 当該予約に対して `lineReminderStatus = "SKIPPED_QUOTA"` がセットされ、Push は実行されない
- 本番で 200 件テストは禁止

ユニットテストの根拠: `tests/line-helpers.test.ts` 等で `pushLineTextMessage` のモック呼び出し挙動を検証している。quota 抑制ロジックの単体テストを追加するなら別タスクとする。

---

## 11. Webhook 確認

Webhook URL を LINE Developers Console に登録した場合のみ実施。任意設定なのでスキップしても予約リマインダーは動く。

```text
1. Messaging API channel の Messaging API タブ → Webhook settings
2. Webhook URL に https://<本番ドメイン>/api/line/webhook が入っていることを確認
3. 「Verify」ボタンを押す → 200 が返れば成功
4. Use webhook を On
```

判定:

- 200 が返る: HMAC-SHA256 署名検証 (`timingSafeEqual`) 通過
- 401: 署名不一致 → `LINE_CHANNEL_SECRET` が Vercel env と LINE Developers Console で食い違っている
- 503: `LINE_CHANNEL_SECRET` が Vercel env に未投入

MVP では follow/unfollow のイベントを受信して DB に書き込む処理は**実装していない**。署名検証して 200 を返すだけ。

---

## 12. 失敗時の切り分け表

| 症状 | 主な原因 | 確認ポイント |
|---|---|---|
| `/booking` に LINE ボタンが出ない | `NEXT_PUBLIC_LIFF_ID` 未投入 / 再 deploy 未実施 | Vercel env と最新 deployment の build log |
| LIFF 連携を押しても何も起きない | スマホ LINE アプリ外で開いている / LIFF Endpoint URL 違い | LIFF アプリ内 / `/booking` URL の一致 |
| `liff.getIDToken()` が null | `openid` scope 不足 / LIFF 設定不備 | LINE Login channel の scope |
| `friendFlag === false` | 公式アカウントを友だち追加していない / ブロック中 | スマホで公式アカウントを友だち追加 |
| 予約は成功するが `lineUserId` が保存されない | ID token verify 失敗 / Provider 違い | 同一 Provider 確認 / `LINE_LOGIN_CHANNEL_ID` が verify endpoint の `aud` と一致 |
| Push が届かない | 友だちでない / `LINE_CHANNEL_ACCESS_TOKEN` 違い / Push API 4xx | Messaging API channel / access token 再発行履歴 |
| cron が 401 | `CRON_SECRET` 不一致 / Bearer ヘッダ未付与 | `Authorization` ヘッダの表記、env の値 |
| cron が `totalCandidates: 0` | 予約日が翌日でない / すでに `lineReminderSentAt` 済み / status 違い | テスト予約の `date`, `status`, `lineUserId`, `lineReminderSentAt` |
| 503 `RESERVATION_SCHEMA_NOT_READY` | migration 未適用 | Supabase の Reservation テーブルに `lineReminder*` 列がない |
| 2 回目の cron で `sent: 0` | 正常（二重送信防止が機能） | `lineReminderSentAt` が埋まっている |
| 通知本文に PII が混入 | コード書き換え事故 | `buildReminderText` の差分確認 |

---

## 13. 合格条件（このフェーズの Done）

以下を全て満たせば本番リリース完了とみなす:

- [ ] LIFF 連携なしの通常予約が従来通り作成できる
- [ ] LIFF 連携あり予約で `Reservation.lineUserId` が保存される
- [ ] `/api/crons/remind` 手動実行で `sent >= 1`
- [ ] LINE 公式アカウントから実機にメッセージが届く
- [ ] `Reservation.lineReminderSentAt` / `lineReminderStatus = "SENT"` が更新される
- [ ] 同じ予約への 2 回目 cron で `sent: 0`（二重送信防止）
- [ ] 通知本文に **電話番号・要望・アレルギー・管理メモ・顧客名**が含まれていない
- [ ] Webhook を登録した場合は LINE Developers Console の「Verify」が 200 で通る
- [ ] テスト予約を管理画面で `CANCELLED` に更新する（本番運用に流れないように後始末）

---

## 14. ユーザーへの承認依頼テンプレ

実機テスト段階で以下の承認文を順に提示する:

```
本番反映を許可: LINE 実機テストの開始（自分のアカウントで /booking 経由予約）
本番反映を許可: 本番 Supabase に対する read-only SELECT（Reservation テーブル確認）
本番反映を許可: 手動 cron 実行 curl POST /api/crons/remind via Bearer CRON_SECRET
本番反映を許可: 二重送信防止確認のための 2 回目 cron 実行
本番反映を許可: テスト予約のキャンセル（管理画面または admin API）
```

それぞれ独立に承認を求める。一括承認は受けない。
