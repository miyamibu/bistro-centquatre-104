# Shortest Recovery Route

This is the fastest trustworthy route to a local working environment. It assumes you either:

- already completed `Path A` and are now inside the clean clone, or
- explicitly chose `Path C` and are staying in the current folder.

The commands below are written for the preferred clean-clone case.

## 1. Confirm the Project Root

```bash
pwd
test -f package.json
test -f package-lock.json
test -f prisma/schema.prisma
test -d src
test -f vercel.json
```

Expected success signal: all tests pass.

## 2. Align to Node 24

Vercel project metadata reports Node `24.x`. Local shell was verified as `v25.8.1`.

```bash
brew install node@24
```

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
hash -r
node -v
npm -v
```

Expected success signal: `node -v` starts with `v24.`.

## 3. Restore Dependencies from the Lockfile

```bash
npm ci
```

Expected success signal: install completes without lockfile drift.

## 4. Reuse Verified Vercel Link Metadata

If your clean clone does not already have `.vercel/project.json`, reuse the verified local metadata from the current folder.

```bash
mkdir -p .vercel
cp /Users/mimac/Desktop/bistro-reservation/.vercel/project.json .vercel/project.json
test -f /Users/mimac/Desktop/bistro-reservation/.vercel/README.txt && cp /Users/mimac/Desktop/bistro-reservation/.vercel/README.txt .vercel/README.txt || true
cat .vercel/project.json
```

Expected success signal: project name is `bistro-centquatre-104`.

## 5. Backup Env Files Before Pulling Anything

```bash
TS="$(date +%Y%m%d-%H%M%S)"
[ -f .env ] && cp .env ".env.backup-$TS"
[ -f .env.local ] && cp .env.local ".env.local.backup-$TS"
ls -1 .env* 2>/dev/null || true
```

Expected success signal: backups exist if original files existed.

## 6. Pull Vercel Env Into Local `.env.local`

```bash
npx vercel env pull .env.local
```

Expected success signal: CLI reports env variables were pulled for the linked project.

Important:
- This step is `REMOTE_OR_STATEFUL_MUTATION`.
- It writes local env state.
- It is still reversible because the prior step created backups.

## 7. Verify the Minimum Required Env Keys

```bash
node - <<'NODE'
const fs=require('fs');
const files=['.env','.env.local'];
const need=['DATABASE_URL','BASE_URL','ADMIN_BASIC_USER','ADMIN_BASIC_PASS','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','CRON_SECRET'];
const have=new Set();
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f,'utf8').split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const i=line.indexOf('=');
    if (i > 0) have.add(line.slice(0,i));
  }
}
console.log(JSON.stringify({
  present: need.filter(k => have.has(k)),
  missing: need.filter(k => !have.has(k))
}, null, 2));
NODE
```

Stop if `DATABASE_URL` is still missing.

## 8. Prisma Verification Gate

Do not run migrations yet.

First, verify the target is identifiable.

```bash
node - <<'NODE'
const fs=require('fs');
for (const f of ['.env.local','.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f,'utf8').split(/\r?\n/)) {
    if (!line.startsWith('DATABASE_URL=')) continue;
    const raw=line.slice('DATABASE_URL='.length);
    try {
      const u=new URL(raw);
      console.log(JSON.stringify({
        protocol: u.protocol,
        host: u.hostname,
        port: u.port || '(default)',
        database: u.pathname.replace(/^\//,'') || '(none)'
      }, null, 2));
    } catch {
      console.log('DATABASE_URL present but not parseable as URL');
    }
  }
}
NODE
```

If host/database is not recognized, stop.

Read-only Prisma checks:

```bash
npx prisma validate
```

```bash
npx prisma migrate status
```

Expected success signal:
- `prisma validate` passes
- `migrate status` identifies the target cleanly

Only after the database target is intentionally identified:

```bash
npx prisma migrate deploy
```

Use `migrate deploy` only for an intended deployment/staging/prod target. Do not run it on an unknown database.

## 9. Local Build Verification

```bash
npm run build
```

Expected success signal: Next build completes without `DATABASE_URL` errors.

## 10. Local Run Verification

```bash
npm run dev
```

In another shell:

```bash
curl -I http://localhost:3000/
```

```bash
curl -s http://localhost:3000/ | head -n 8
```

Expected success signal:
- `HTTP/1.1 200 OK`
- HTML begins with `<!DOCTYPE html>`

## What To Postpone Until After Local Green

- Any git surgery in the current folder
- Any Vercel deploy
- Any Prisma write action against an unknown database
- Any attempt to fix preview deployment failures before local build is green
