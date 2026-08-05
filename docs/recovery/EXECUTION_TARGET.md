# 実行対象と復旧対象

## Canonical execution target

The canonical application in this workspace is:

`/Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation`

Run development, validation, migration generation, and release checks from that directory.

## Non-canonical linked worktree

`/Users/mimac/Desktop/レストラン予約サイト_本体とバックアップ/bistro-reservation-go-implementation`

is an older linked worktree of the same Git repository. It is not a drop-in backup of the canonical application: its checked-out revision, schema, and operational protections may differ. Do not start or restore it as a replacement without an explicit revision, schema, and feature compatibility review.

## Recovery gate

Before any recovery or launch operation, verify:

1. The working directory is the canonical path above.
2. `git branch --show-current` and `git rev-parse HEAD` match the approved release evidence.
3. `prisma/schema.prisma` and the applied migration set include the current reservation idempotency, notification outbox, management token, contact policy, and operations audit migrations.
4. The backup payload schema version and migration state are compatible before restoring data.

Do not delete or overwrite either directory as part of recovery. Preserve the original evidence and use a separately verified working copy when a rollback is required.
