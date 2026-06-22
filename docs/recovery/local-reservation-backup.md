# Local Reservation Backup

## Goal

予約データを `bistro-reservation/backups` 配下に集約し、保存場所を一本化します。
予約フォームと管理画面のUXは変更せず、裏側でバックアップ運用を強化します。

## Required env

- `BACKUP_BASE_URL` または `BASE_URL`
  - 例: `https://bistro-centquatre-104.vercel.app`
- `BACKUP_EXPORT_SECRET` (専用secret。`CRON_SECRET` へのフォールバックは禁止)
- `ADMIN_BASIC_USER` / `ADMIN_BASIC_PASS` (`/api/admin/...` 経由のため必須)
- `BISTRO_BACKUP_DIR` (任意)
  - 未指定時の標準保存先は `bistro-reservation/backups/reservation-daily-backups`

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
- バックアップJSONと本番DBを突き合わせ、二重登録/欠損を確認してから反映する
- `latest-run.json` の時刻と件数を見て、欠損期間がないか確認する
- DBへの直接書き戻しは必ず別承認フローで実施する
