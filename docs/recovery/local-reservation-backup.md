# Local Reservation Backup

## Goal

予約データを `bistro-reservation/backups` 配下に集約し、保存場所を一本化します。
通常の予約フォームと管理画面の導線を壊さず、顧客の管理リンク／確認メールと
バックアップの復旧可能性を含む運用を強化します。

## Required env

- `BACKUP_BASE_URL` または `BASE_URL`
  - 例: `https://bistro-centquatre-104.vercel.app`
- `BACKUP_EXPORT_SECRET` (専用secret。`CRON_SECRET` へのフォールバックは禁止)
- `BACKUP_ENCRYPTION_KEY` または `BACKUP_ENCRYPTION_KEYS_JSON` + `BACKUP_ENCRYPTION_ACTIVE_KEY_ID`
  (32文字以上。CLI引数には渡さない)
- `BISTRO_BACKUP_DIR` (任意)
  - 未指定時の標準保存先は `bistro-reservation/backups/reservation-daily-backups`
- `BACKUP_CLEANUP_ENABLED` (任意)
  - 指定しない場合は `false` とみなし、日次バックアップのアーカイブ移動（実質削除）を実行しません。
  - `true` にしたうえ、かつ `--apply=true --confirm-safe-target=archive-reservation-backups` で実行した場合のみ、`cleanup` が実体移動を行います。

新規の予約payloadはアプリ層のAES-256-GCMで暗号化され、日次ファイルは
`days/YYYY-MM-DD.json.enc`、単発ファイルは `reservations-*.json.enc` になります。
`latest-run.json` と `runs/*.json` は件数、checksum、暗号化形式、鍵IDなどのメタデータのみです。
既存の平文 `*.json` バックアップは削除・変更せず、暗号化対応後のcleanup対象にも含めません。

## Manual run

```bash
cd /Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation
npm run backup:reservations
```

オプション例:

```bash
npm run backup:reservations -- --date=2026-04-22
npm run backup:reservations -- --from=2026-04-01 --to=2026-04-22
npm run backup:reservations -- --out-dir=backups/manual-export-backups
npm run backup:reservations -- --dry-run=true
```

鍵は環境変数または標準入力から渡します。端末の履歴やプロセス一覧に秘密値を残さないため、
`--secret`、`--admin-pass` などの秘密CLI引数は使用しません。

```bash
read -r -s BACKUP_ENCRYPTION_KEY
export BACKUP_ENCRYPTION_KEY
npm run backup:reservations
unset BACKUP_ENCRYPTION_KEY
```

保護されたstdin入力を使う場合は次の形式です（鍵ファイルの権限と保管場所は運用側で管理してください）。

```bash
npm run backup:reservations -- --encryption-key-stdin < /secure/path/backup-encryption-key
```

### 鍵輪番と保管

本番では `BACKUP_ENCRYPTION_KEYS_JSON='{"v1":"旧鍵...","v2":"新鍵..."}'` と
`BACKUP_ENCRYPTION_ACTIVE_KEY_ID=v2` を使います。旧鍵は、旧世代ファイルを検証し終えるまで
削除しません。鍵本文はリポジトリ、Vercelのログ、plist、シェル履歴に保存せず、別管理の
パスワード保管庫へ2名以上の管理者で保管してください。`keyId` は暗号文のメタデータとして
記録されますが、鍵本文は記録されません。

最低限、次の運用を月1回実施します。

1. 本番とは別の一時ディレクトリへ暗号化ファイルをコピーする。
2. `npm run backup:restore-drill -- --file=<コピーした.enc>` を実行する。
3. `ok: true`、`databaseWrite: "NOT_SUPPORTED"`、鍵ID、暗号化ファイルSHA-256、件数、schemaVersionを確認する（DBへの書き戻しは行わない）。
4. 成功日時・対象ファイル・操作者2名を運用台帳へ記録する。

予約エクスポートの運用目標は RPO 24時間以内です。`DRY_RUN_RESTORE_VALIDATION`
は復号・形式・整合性を検証しますが、DB書き戻し時間を証明しません。60分RTOは、
隔離DBへの時限付きエンドツーエンド演習を反復して達成するまで未証明として扱います。

## Canonical storage layout

- 日次同期バックアップ: `backups/reservation-daily-backups`
- 単発エクスポート: `backups/manual-export-backups`
- プロジェクトスナップショット: `backups/project-snapshots`
- ワークスペース bundle: `backups/workspace-snapshots`

`backups/reservation-daily-backups` を正本として扱い、日常確認はこのフォルダだけ見れば十分です。

## launchd (macOS daily)

1. `~/Library/LaunchAgents/com.bistro.reservation-backup.plist` を作成
2. 例 (毎日 02:20):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>com.bistro.reservation-backup</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string>
      <string>-lc</string>
      <string>cd /Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation && npm run backup:reservations:run >> /tmp/bistro-reservation-backup.log 2>&1</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key><integer>2</integer>
      <key>Minute</key><integer>20</integer>
    </dict>
    <key>RunAtLoad</key><true/>
  </dict>
</plist>
```

3. 反映:

```bash
launchctl unload ~/Library/LaunchAgents/com.bistro.reservation-backup.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.bistro.reservation-backup.plist
```

launchd/cronで `npm run backup:reservations:run` を実行する場合も、起動プロセスへ
`BACKUP_ENCRYPTION_KEY` を安全な方法で注入してください。plist、cron引数、ログに鍵を平文で
書かないでください。鍵がない場合、バックアップpayloadの保存は失敗します。

## cron (daily)

```cron
20 2 * * * cd /Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation && npm run backup:reservations:run >> /tmp/bistro-reservation-backup.log 2>&1
```

## Project snapshot (folder recovery)

`.env.local` を除外した世代スナップショット:

```bash
npm run backup:project-snapshot
npm run backup:project-snapshot -- --dry-run
```

## Recovery notes

- 復旧前に、現在フォルダのフルコピーを必ず取得する
- 暗号化バックアップは保存時と同じ鍵で復号し、checksumと件数を検証する
- 鍵IDが解決できない場合は、旧鍵を保管庫から復元してから再試行する。鍵本文をログに出さない
- バックアップpayloadと本番DBを突き合わせ、二重登録/欠損を確認してから反映する
- `latest-run.json` だけで判断せず、`runs/*.json` を含む最新実行の時刻、暗号化ファイルSHA-256、暗号化メタデータを `npm run backup:reservations:status` で照合する
- workspace bundle は、承認済みrelease commitの40文字SHAを指定した `npm run backup:workspace:status -- --expected-head=<承認済み40文字SHA>` に成功してからrelease証跡として扱う。この検査は `git bundle verify`、`latest.bundle.provenance.json` のHEAD SHA、指定した承認SHA、bundle SHA-256を照合し、古いbundleを拒否する
- DBへの直接書き戻しは必ず別承認フローで実施する
