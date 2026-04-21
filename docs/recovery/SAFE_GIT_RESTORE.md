# Safe Git Restore

## Why Current Folder Preservation Matters

- The current working folder at `/Users/mimac/Desktop/bistro-reservation` is the user's live merged working copy.
- It has no `.git`.
- It is newer than the archived git-managed copy under `iCloud Drive（アーカイブ）`.
- Deleting it or reinitializing git in place would destroy forensic evidence and raise the risk of silent drift.

## Safest Recovery Path

Use a clean sibling clone. Do not repair git inside the current folder first.

### High-Level Sequence

1. Backup the current folder.
2. Clone a fresh sibling from GitHub.
3. Validate remote and branches in the clean clone.
4. Compare current folder vs clean clone app subtree.
5. Only after comparison, migrate local-only files into the clean clone.
6. Keep the old folder intact.

### Exact Commands

```bash
ROOT="/Users/mimac/Desktop/bistro-reservation"
DESKTOP="/Users/mimac/Desktop"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="$DESKTOP/bistro-reservation.backup-$TS"
CLONE="$DESKTOP/french-restaurant-site.recovered-$TS"
REMOTE="https://github.com/miyamibu/french-restaurant-site.git"
```

```bash
ditto "$ROOT" "$BACKUP"
```

Expected success signal: `"$BACKUP"` exists and contains `package.json`, `src/`, `prisma/`, and `supabase/`.

```bash
git clone "$REMOTE" "$CLONE"
```

Expected success signal: `"$CLONE/.git"` exists.

```bash
git -C "$CLONE" remote -v
git -C "$CLONE" branch -r
git -C "$CLONE" rev-parse --show-toplevel
```

Expected success signal:
- remote is `origin https://github.com/miyamibu/french-restaurant-site.git`
- remote branches include `origin/main`
- remote branches include `origin/codex/rescue-cleanup`

```bash
APP_CLONE="$CLONE/bistro-reservation"
test -d "$APP_CLONE/src" && test -f "$APP_CLONE/package.json" && test -f "$APP_CLONE/prisma/schema.prisma"
```

Expected success signal: shell exits `0`.

```bash
diff -rq "$ROOT" "$APP_CLONE" \
  -x node_modules \
  -x .next \
  -x .vercel \
  -x '*.log' \
  -x '*.png' \
  -x '*.jpg' \
  -x '*.jpeg' \
  -x '*.webp' \
  -x tsconfig.tsbuildinfo | tee "$DESKTOP/bistro-recovery-diff-$TS.txt"
```

Expected success signal: diff report exists and is reviewable before any copy.

## In-Place Path Only as Secondary Option

Do not use this first.

### Preconditions

- `BACKUP` exists.
- Clean clone exists and passed validation.
- Diff against clean clone is small and explained.

### Safer Version of In-Place Reattach

If you still choose in-place restore, use a clean clone as the `.git` source, not the archived dirty repo.

```bash
CURRENT="/Users/mimac/Desktop/bistro-reservation"
SAFE_GIT_SOURCE="$CLONE/.git"
test -d "$CURRENT" && test -d "$SAFE_GIT_SOURCE"
```

```bash
ditto "$CURRENT" "$CURRENT.pre-git-reattach-$TS"
```

```bash
cp -R "$SAFE_GIT_SOURCE" "$CURRENT/.git"
```

```bash
git -C "$CURRENT" status --short --branch
git -C "$CURRENT" remote -v
git -C "$CURRENT" fsck --full
```

Stop if any output is surprising. If it looks wrong, delete the transplanted `.git` and go back to the backup copy, not to the live folder.

## Explicit Do-Not-Run Commands

- `git init /Users/mimac/Desktop/bistro-reservation`
- `git reset --hard`
- `git clean -fd`
- `rsync --delete` into the current folder
- `rm -rf /Users/mimac/Desktop/bistro-reservation`
- `git remote set-url origin ...` in the current folder before clean-clone validation

## Backup Procedure

```bash
ROOT="/Users/mimac/Desktop/bistro-reservation"
TS="$(date +%Y%m%d-%H%M%S)"
ditto "$ROOT" "/Users/mimac/Desktop/bistro-reservation.full-backup-$TS"
```

## Validation Procedure After Restore

```bash
git -C "$CLONE" status --short --branch
git -C "$CLONE" remote -v
git -C "$CLONE" branch -r
```

```bash
cd "$CLONE/bistro-reservation"
node -v
npm -v
test -f package-lock.json
test -f prisma/schema.prisma
test -f vercel.json
```

If git is healthy only in the clean clone, use the clean clone as the future canonical repo and keep the current folder as a preserved evidence copy.
