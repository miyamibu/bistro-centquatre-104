# Workspace bundle retention policy

## Goal

復旧可能性を維持しつつ、workspace bundle がリモート追跡refや一時agent refを取り込んで無制限に増えることを防ぎます。

## Creation scope

`npm run backup:workspace:snapshot` が新規作成するbundleは、実行時の `HEAD`、ローカルbranch、tagだけを含めます。リモート追跡ref、checkpoint ref、agent固有ref、未コミットファイル、秘密値は含めません。作成後は `git bundle verify`、HEAD SHA、bundle SHA-256を検証します。

## Retention tiers

- 日次: 直近14世代
- 週次: 直近8世代
- 月次: 直近12世代
- release: 承認済みrelease SHAへ結び付いた世代は、次の復旧演習成功まで保持

既存bundleは自動削除しません。削除候補の選定、別媒体への退避、復元確認、削除はそれぞれ別の運用判断とし、予約export、provenance、検証記録を同時に消してはいけません。

## Validation

release証跡として採用する前に、次を実行します。

```bash
npm run backup:workspace:status -- --expected-head=<承認済み40文字SHA>
```

予約export、workspace bundle、validationは別レーンとして報告します。一つの成功を他の成功として扱いません。
