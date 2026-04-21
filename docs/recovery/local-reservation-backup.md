# Local Reservation Backup (Free)

## Goal

`/api/admin/backups/reservations/export` から予約データをローカルへ日次保存し、30日より古い営業日のデータを自動削除します。
既定の保存先はリポジトリ内ではなく、OSごとのユーザーデータ領域です。

## Required env

- `BACKUP_EXPORT_SECRET`
  - バックアップAPIの Bearer トークンです。
  - API側は `BACKUP_EXPORT_SECRET` が未設定の場合 `CRON_SECRET` を使用します。
- `ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS`
  - `/api/admin/...` のバックアップAPIへアクセスするために必要です。
- `BACKUP_BASE_URL` (推奨)
  - 例: `https://bistro-centquatre-104.vercel.app`
  - リダイレクト元ドメインを使うと認証ヘッダーが引き継がれない場合があるため、正規ドメインを指定します。
- `BACKUP_OUTPUT_DIR` (任意)
  - 未指定時の macOS 既定値: `~/Library/Application Support/bistro-reservation/backups/reservation-status`
  - 個人情報を含むため、リポジトリ外の保存先を推奨します。

## Run manually

```bash
cd /Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation
npm run backup:reservations:pull
npm run backup:reservations:cleanup
```

一括実行:

```bash
npm run backup:reservations:run
```

ワークスペースの Git 履歴 bundle も外部保存する場合:

```bash
npm run backup:workspace:snapshot
```

## Main options

`backup:reservations:pull`:

- `--base-url=https://your-production-domain`
- `--secret=...`
- `--from=YYYY-MM-DD --to=YYYY-MM-DD`
- `--lookback-days=30 --lookahead-days=60`
- `--chunk-days=30`
- `--out-dir=backups/reservation-status`
  - 未指定ならOS既定の安全な外部ディレクトリを使用

`backup:reservations:cleanup`:

- `--retention-days=30` (30日未満は拒否)
- `--today=YYYY-MM-DD`
- `--out-dir=backups/reservation-status`
  - 未指定ならOS既定の安全な外部ディレクトリを使用

## Output

- `<BACKUP_OUTPUT_DIR>/days/YYYY-MM-DD.json`
- `<BACKUP_OUTPUT_DIR>/runs/pull-*.json`
- `<BACKUP_OUTPUT_DIR>/latest-run.json`
- `<BACKUP_OUTPUT_DIR>/../../workspace-snapshots/workspace-*.bundle`
- `<BACKUP_OUTPUT_DIR>/../../workspace-snapshots/latest.bundle`

各 `days/*.json` には次が含まれます:

- `businessDay`
- `reservations` (全ステータス)
- `privateBlockAuditLogs`
- `checksumSha256` と `requestId`

## Suggested automation (macOS cron example)

```cron
20 2 * * * cd /Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation && npm run backup:reservations:run >> /tmp/bistro-reservation-backup.log 2>&1
```
