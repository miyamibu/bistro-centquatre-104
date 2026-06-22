# Backup Storage Layout

## Goal

バックアップ関連の保存先を `bistro-reservation/backups` 配下に集約し、見る場所を一つにする。

## Canonical paths

- 日次予約バックアップ: `backups/reservation-daily-backups`
- 単発エクスポート: `backups/manual-export-backups`
- プロジェクトスナップショット: `backups/project-snapshots`
- ワークスペース bundle: `backups/workspace-snapshots`

## Operational rule

1. 日常運用で確認する正本は `backups/reservation-daily-backups`
2. 古い外部保存先は互換用の symlink のみ許可
3. 新しいバックアップ設定は repo 外の別パスを標準にしない
4. `backups` 配下は Git 管理しない
