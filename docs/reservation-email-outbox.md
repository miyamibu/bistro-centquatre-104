# Reservation confirmation email outbox

店舗向け予約通知と顧客向け確認メールは、予約APIから直接送信しません。予約作成と同じPrisma
transactionで`ReservationEmailOutbox`へ送信意図を保存し、保護されたCron
routeが後から処理します。顧客メールには180日有効の管理リンクが含まれ、管理リンクから確認メールを再送できます。

## State flow

1. `PENDING`: 送信待ち
2. `PROCESSING`: claim済み。5分のlockとclaim tokenで同時workerを排他
3. `SENT`: メールproviderが成功を返した後にだけ設定
4. `SKIPPED`: 送信直前に予約が`CONFIRMED`/`NORMAL`ではない場合。理由は`lastError`へ保存
5. `DEAD_LETTER`: 5回失敗し、自動再試行を停止

失敗時の再試行間隔は1分、2分、4分、8分です。Cronの実行間隔がこれより
長い場合、実際の再試行は次のCron呼び出しまで遅延します。

## Idempotency and data handling

- Unique keyは`(reservationId, notificationType)`です。
- enqueueの再実行は既存の`SENT`、`DEAD_LETTER`、attempt数を初期化しません。
- 初回送信と自動再試行のprovider idempotency keyは`reservation-email-outbox/<outboxId>`で固定します。
- 顧客が確認メールを明示的に再送する場合だけ、`reservation-email-outbox/resend/<uuid>`の新しい世代キーを発行します。
- provider受理IDは`providerMessageId`へ保存し、受理後の状態更新失敗時も保存を試みます。
- 顧客向け`CUSTOMER_CONFIRMATION`は予約メールアドレスがない場合に`SKIPPED`となります。メール登録済みの予約は管理リンクの再送操作で新しい配送世代として再試行できます。
- outboxに氏名、電話番号、メール本文は複製しません。
- ログにはoutbox ID、reservation ID、attempt数、定型エラーコードだけを残します。
- `Reservation`への外部キーは`ON DELETE RESTRICT`です。

## Processor

- Route: `/api/crons/process-reservation-emails`
- Method: `GET`または`POST`
- Auth: `Authorization: Bearer <CRON_SECRET>`
- 1回の既定処理件数: 10件（最大50件）
- 1件ずつ順番に送信
- `batchSize`、`cursor`、`deadlineMs`のquery parameterで継続処理と実行時間上限を指定できます。
- 再試行予定、claim競合、状態保存失敗を含む場合は、取りこぼし防止のため`nextCursor`を返しません。次のsweepはcursorなしで開始してください。

送信失敗、dead-letter発生、または状態保存不能が1件以上ある場合、routeは
HTTP 500を返します。Vercel Cron自体は失敗実行を自動再試行しないため、次回
scheduleでdue rowを再取得します。

## 管理画面の観測値

`/api/admin/outbox/status` は従来の `backlog` と `heartbeats` を維持し、
`deadLetters` に現在 `DEAD_LETTER` 状態の未解決総数と最古作成時刻を追加します。
予約・注文とも件数は読取専用の集計であり、通知状態や再送条件は変更しません。
処理待ち件数・dead-letter件数・heartbeatは独立した照会結果で、並行更新中に
同一時点のスナップショットとは限りません。合計・差分を原子的な残高として
扱わないでください。
`backlog` は処理可能な待ち行列で、`DEAD_LETTER` を含みません。
Cron/手動処理の `deadLetter` と heartbeat の `deadLetterCount` は、その実行で
新たにdead-letter化した件数です。後続実行が成功して0件でも、既存の
`deadLetters` は残ります。

`scheduler` はGitHub schedulerのレーン別最終heartbeat開始時刻、最終成功時刻、
最終失敗時刻を別々に返します。heartbeat開始は実行成功や通知配達を意味しません。
`SENT` はメール事業者のAPIが送信を受け付けた状態です。受信先への配達・閲覧を
確認する仕組みはこのoutboxにないため、配達済み件数として扱いません。
このstatus APIは既存どおり管理者認可と読取要求の検査を通り、個人情報や
provider ID・secretを新たに返しません。

## GitHub workflowのHTTP再試行観測

`production-notification-outbox-drain.yml` は既存の `curl --retry 1
--retry-all-errors` と送信条件を維持し、受信HTTPヘッダーからlane別に応答順序・
HTTP状態・安全なコード・時刻だけをjob summaryとログに残します。最初のHTTP500後、
同じcurl呼出しの再試行が200になっても、`HTTP_recovered=YES` と
`delivery_recovery=UNVERIFIED` を別に記録します。最後のsweepが0件でも配送回復の
証拠にはなりません。通知状態・メールの再試行間隔・heartbeat保存方法は変更しません。

`attempt` は受信したHTTP応答の順番です。HTTP応答のない接続失敗などは完全な
試行数を観測できないため、欠測を明示します。`responseAt` はサーバーのDate
ヘッダー（欠測/不正時はunknown）、`recordedAt` はlane呼出し終了後の記録時刻です。
最初の失敗コードはHTTP状態から作る固定コード、最終APIコードは許可リストのみです。
最終APIコードはlane別に検査し、本文は16KiBまでを観測対象とします。成功/失敗とも
最終sweepの件数を0〜1,000,000の整数に限定して表示し、欠測/不正値はUNKNOWNです。
部分失敗500の送信済み件数が正でも、そのsweepの失敗判定は維持します。
レスポンス本文・その他のヘッダー・curlの診断本文は一時ファイルに限定して削除し、
summaryに氏名・メール・provider受付ID・secretを保存しません。

## Migration and deployment order

Migrations:

`20260728090000_add_reservation_email_outbox`

`20260728093000_restrict_reservation_related_deletes`

`20260731102000_harden_notification_delivery_claims`

`20260803090000_customer_contact_policy_token_keyring`

`20260803100000_rename_private_block_audit_staff_source`

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
