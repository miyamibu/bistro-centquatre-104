# Recovery Runbook

## Executive Summary

- Canonical working root: `/Users/mimac/Desktop/bistro-reservation`
- Primary path: `Path A — SAFEST_CANONICAL`
- Fallback path: `Path C — MINIMAL_LOCAL_RECOVERY`
- Do not restore git in-place first.
- Do not run Prisma migrations until `DATABASE_URL` is restored and the target is identified.

## Current Verified State

- Current working root has app files, `src/`, `prisma/schema.prisma`, `supabase/`, `vercel.json`, `.vercel/project.json`, `package.json`, and `package-lock.json`.
- Current working root does **not** have `.git`.
- `npm run dev` reached `Ready` and `curl -I http://localhost:3000/` returned `200 OK`.
- `npm run build` failed because `DATABASE_URL` is missing during production build.
- `npm run check:release` failed because `DATABASE_URL` and `BASE_URL` are missing locally.
- `gh` CLI is absent.
- `vercel` CLI is available as `Vercel CLI 50.38.3`.
- Prisma CLI is available as `5.22.0`.
- Supabase SQL files exist:
  - `supabase/schema.sql`
  - `supabase/rls-policies.sql`
  - `supabase/verify.sql`
- Vercel project link is present and points to project `bistro-centquatre-104`.
- Vercel project metadata reports Node `24.x`.
- Local shell Node is `v25.8.1`.

## Canonical Root Decision

- Chosen root: `/Users/mimac/Desktop/bistro-reservation`
- Why:
  - It is the only live Desktop candidate that exists.
  - It matches the merged working copy exactly: `bistro-reservation_merged_2026-04-04/project`.
  - It contains the latest runbook-related files not present in the archived git-managed copy, including `.env.local.example` and `scripts/check-release-safety.mjs`.
- Non-canonical siblings:
  - `/Users/mimac/Desktop/bistro-reservation_merged_2026-04-04/project`
    - Same project content, but clearly labeled merged output.
  - `/Users/mimac/Desktop/１bistro-reservation/_from_bistro-reservation_before_apply_2026-04-04`
    - Backup snapshot.
  - `/Users/mimac/iCloud Drive（アーカイブ）/Desktop/french-restaurant-site`
    - Has `.git`, but branch is `publish/all-20260322`, is behind `origin/main` by 3 commits, and is dirty with many artifact files.

## Recovery Paths

### Path A — SAFEST_CANONICAL

Use this unless new evidence disproves it.

- Prerequisites:
  - Enough disk space for one backup and one clean clone.
  - Git available locally.
  - GitHub remote reachable: `https://github.com/miyamibu/french-restaurant-site.git`
- Exact shape:
  1. Backup the current folder to a timestamped sibling copy.
  2. Clone a fresh sibling copy from the canonical GitHub remote.
  3. Use the clean clone as the future git working copy.
  4. Compare current-folder contents against the clean clone's `bistro-reservation/`.
  5. Migrate only verified local-only changes.
  6. Restore local env safely into the clean clone.
- Expected success signals:
  - Clean clone has `.git`.
  - `git remote -v` shows `origin https://github.com/miyamibu/french-restaurant-site.git`.
  - `git branch -r` includes `origin/main` and `origin/codex/rescue-cleanup`.
  - `diff -rq` between old folder and clean clone is understandable before any file copy.
- Risks:
  - Moderate time cost.
  - User changes can still be missed if you copy files before reviewing the diff.
- Rollback:
  - Original current folder remains intact.
  - Timestamped backup remains intact.
- Drift Score: `1/5`
- Choose when:
  - You want the safest return to a healthy git-backed repo.
- Do not choose when:
  - You only need the app running locally today and do not care about git yet.

### Path B — IN_PLACE_GIT_REATTACH

Secondary option only. Riskier than Path A.

- Preconditions:
  - Full backup of current folder completed.
  - Fresh clean clone exists and is verified.
  - Diff current folder vs clean clone is small and understandable.
  - You have explicitly decided to keep the current folder path as the future canonical git working copy.
- Exact shape:
  1. Create a clean verified clone first.
  2. Compare clone vs current folder.
  3. Only if the diff is acceptable, copy the clean clone's `.git` into a backup of the current folder or transplant it into the current folder after full backup.
  4. Re-run `git status`, `git remote -v`, and `git fsck`.
- Expected success signals:
  - `git status` works in the current folder.
  - `git remote -v` shows the expected remote.
  - `git status --short` only shows explainable local differences.
- Risks:
  - High risk of attaching the wrong git history to a drifted tree.
  - High risk of masking moved-folder damage.
  - Archived repo is not suitable as a direct transplant source because it is dirty and behind `origin/main`.
- Rollback:
  - Restore the full backup copy of the current folder.
- Drift Score: `4/5`
- Choose when:
  - Path A is impossible and you must preserve the exact folder path.
- Do not choose when:
  - You have any doubt about content drift.
  - You are tempted to use `git init` as a shortcut.

### Path C — MINIMAL_LOCAL_RECOVERY

Fastest path to local runnability if git restoration is deferred.

- Prerequisites:
  - You accept that repo hygiene remains unresolved.
  - You only need a trustworthy local app, not a healthy git working copy.
- Exact shape:
  1. Stay in the current folder.
  2. Align to Node 24.
  3. Restore dependencies with the lockfile.
  4. Backup env files.
  5. Reuse `.vercel/project.json` and pull env from Vercel.
  6. Verify `DATABASE_URL` before touching Prisma.
  7. Run build and local smoke tests.
- Expected success signals:
  - `node -v` reports `v24.x`.
  - `npm ci` succeeds.
  - `npx prisma validate` succeeds after env restoration.
  - `npm run build` succeeds.
  - `npm run dev` serves `200 OK`.
- Risks:
  - Git is still broken locally.
  - Local folder remains detached from repo history.
- Rollback:
  - Restore backed-up `.env*` files.
  - Delete `node_modules` and reinstall if needed.
- Drift Score: `3/5`
- Choose when:
  - Immediate local recovery matters more than repo restoration.
- Do not choose when:
  - You need safe future release work or reliable PR-based deployment workflow.

## Auditor Comparison

- Primary recommendation: `Path A`
  - Lowest drift score.
  - Preserves the current folder untouched.
  - Avoids attaching git history to a possibly drifted tree.
- Fallback recommendation: `Path C`
  - Fastest way back to local confidence.
  - Acceptable if the immediate goal is local runnability, not repo hygiene.
- Hidden assumptions:
  - The GitHub remote remains the canonical source of truth.
  - The clean clone will still place the app in `french-restaurant-site/bistro-reservation`.
  - Vercel still has the missing env values; this is not yet verified.
  - The restored `DATABASE_URL` will point to the intended database target.
- What would change the recommendation:
  - If a clean new clone from GitHub does not match the expected repo layout.
  - If Vercel env pull cannot restore the missing keys.
  - If the current folder contains newer local-only code that is not in remote and cannot be safely diffed.

## Recommended Step-by-Step Procedure

1. Follow `SAFE_GIT_RESTORE.md` and execute `Path A`.
2. Only after the clean clone exists, follow `SHORTEST_RECOVERY_ROUTE.md` inside the clean clone.
3. Stop before any Prisma migration if the database target is unknown.
4. Do not deploy from a detached folder.

## Stop Conditions

- Stop if the fresh clone remote is not `miyamibu/french-restaurant-site`.
- Stop if `origin/main` or `origin/codex/rescue-cleanup` is missing in the fresh clone.
- Stop if `vercel env pull` does not restore `DATABASE_URL`.
- Stop if the recovered `DATABASE_URL` points to an unknown host or unknown database.
- Stop if `diff -rq` shows large unexplained drift before you copy files.

## Success Criteria

- Clean git-backed clone exists.
- Local env files are backed up before any overwrite.
- Node is aligned to `24.x`.
- `npm ci` succeeds in the clean clone.
- `npx prisma validate` succeeds.
- `npm run build` succeeds.
- `npm run dev` returns `200 OK` on `/`.
