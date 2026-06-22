# Git And Remote Backup

## Goal

ローカル事故時に巻き戻し可能な履歴を維持し、外部リモートを併用して復旧性を上げます。

## 1) Initial local setup (if `.git` is missing)

```bash
cd /Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation
npm run security:env
npm run security:destructive
git init
```

## 2) Secret-safe first commit

```bash
git status --short
git add .
git status --short
git commit -m "chore: baseline snapshot after security hardening"
```

確認ポイント:

- `.env.local` が `git status` / `git ls-files` に出ない
- `backups/**/*.json` が追跡されていない
- 差分に secret 値が含まれていない

## 3) Add remote and push (manual confirmation required)

```bash
git remote add origin <your-private-remote-url>
git push -u origin main
```

`push` は外部送信なので、運用者確認後に実施してください。

## 4) Rollback examples

```bash
git log --oneline --decorate -n 20
git restore --source=<commit> -- path/to/file
git revert <commit>
```

不可逆な上書き (`git reset --hard`) は通常運用で使わないでください。

## 5) Layered backups recommended

- Git local history
- Private remote (GitHub/GitLab)
- Time Machine (macOS)
- 外部ストレージへの定期スナップショット (`npm run backup:project-snapshot`)

単一手段だけに依存しないことが重要です。
