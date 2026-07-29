# Reservation confirmation email outbox

予約確認メールは、予約APIから直接送信しません。予約作成と同じPrisma
transactionで`ReservationEmailOutbox`へ送信意図を保存し、保護されたCron
routeが後から処理します。

## State flow

1. `PENDING`: 送信待ち
2. `PROCESSING`: claim済み。5分のlockとclaim tokenで同時workerを排他
3. `SENT`: メールproviderが成功を返した後にだけ設定
4. `DEAD_LETTER`: 5回失敗し、自動再試行を停止

失敗時の再試行間隔は1分、2分、4分、8分です。Cronの実行間隔がこれより
長い場合、実際の再試行は次のCron呼び出しまで遅延します。

## Idempotency and data handling

- Unique keyは`(reservationId, notificationType)`です。
- enqueueの再実行は既存の`SENT`、`DEAD_LETTER`、attempt数を初期化しません。
- outboxに氏名、電話番号、メール本文は複製しません。
- ログにはoutbox ID、reservation ID、attempt数、定型エラーコードだけを残します。
- `Reservation`への外部キーは`ON DELETE RESTRICT`です。

## Processor

- Route: `/api/crons/process-reservation-emails`
- Method: `GET`または`POST`
- Auth: `Authorization: Bearer <CRON_SECRET>`
- 1回の最大処理件数: 10件
- 1件ずつ順番に送信

送信失敗、dead-letter発生、または状態保存不能が1件以上ある場合、routeは
HTTP 500を返します。Vercel Cron自体は失敗実行を自動再試行しないため、次回
scheduleでdue rowを再取得します。

## Migration and deployment order

Migrations:

`20260728090000_add_reservation_email_outbox`

`20260728093000_restrict_reservation_related_deletes`

安全な順序:

1. staging/test DBへmigrationを適用
2. unit/DB testを実行
3. Production DBへmigrationを適用
4. 同じschemaを使うアプリをdeploy
5. Cron routeの401、認証済み空実行、synthetic mailを確認

アプリを先にdeployすると、schema readiness checkが
`RESERVATION_SCHEMA_NOT_READY`を返します。

`vercel.json`は5分間隔です。Vercel Hobbyは1日1回より高頻度のCronを
受け付けないため、deploy前にPro/Enterprise相当のCron利用条件を確認してください。
