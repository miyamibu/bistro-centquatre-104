# Deployment & Infrastructure Setup Guide

## Project Information

**Project Name**: Bistro Reservation System  
**Repository**: french-restaurant-site  
**Monorepo Structure**: bistro-reservation (main app)  

## Deployment Platforms

### 1. Frontend/API: Vercel

**Current Configuration**: `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/crons/cancel-expired-orders",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/crons/delete-old-histories",
      "schedule": "0 1 * * *"
    }
  ]
}
```

**Deployment URI**: Should be set in Vercel Project Settings  
**Environment Variables Needed**: See below

### 2. Database: Supabase (PostgreSQL)

**RLS Policy File**: `supabase/rls-policies.sql`  
**Migration Files**: `prisma/migrations/`

## Environment Variables Setup

### Development (`.env.local`)

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/bistro

# Base URL
BASE_URL=http://localhost:3000

# Admin Authentication
ADMIN_BASIC_USER=admin
ADMIN_BASIC_PASS=changeme

# Email Configuration
EMAIL_PROVIDER=resend
EMAIL_API_KEY=your-email-api-key
EMAIL_FROM=no-reply@example.com
STORE_NOTIFY_EMAIL=your-email@example.com

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# LINE Integration (optional)
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
LIFF_ID=

# Cron Security
CRON_SECRET=your-cron-secret-token-here
```

### Production (Vercel Project Settings → Environment Variables)

Add these from **Vercel Dashboard**:

1. `DATABASE_URL` - Production PostgreSQL connection string
2. `ADMIN_BASIC_USER` - Admin username
3. `ADMIN_BASIC_PASS` - Strong admin password
4. `EMAIL_PROVIDER` - Email service provider
5. `EMAIL_API_KEY` - Email service API key
6. `EMAIL_FROM` - Sender email address
7. `STORE_NOTIFY_EMAIL` - Notification email
8. `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
9. `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
10. `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (**NEVER expose to client**)
11. `CRON_SECRET` - Strong random token for cron jobs
12. `LINE_CHANNEL_*` - LINE Bot credentials (if used)

### Security Best Practices for Environment Variables

✅ **DO:**
- Use Vercel's encrypted environment variable storage
- Rotate secrets every 90 days
- Use different values for dev/staging/production
- Keep `SUPABASE_SERVICE_ROLE_KEY` as server-side only

❌ **DON'T:**
- Commit `.env` files to Git (already in `.gitignore`)
- Share environment variables in Slack/email
- Use same passwords for all environments
- Expose `SUPABASE_SERVICE_ROLE_KEY` to frontend

## Initial Setup Checklist

### 1. Supabase Project Creation

```bash
# Steps:
1. Create project on supabase.com
2. Get NEXT_PUBLIC_SUPABASE_URL and keys
3. Copy DATABASE_URL from connection pooler
```

### 2. Database Schema & RLS

```bash
# Run migrations:
npx prisma migrate deploy

# Apply RLS policies:
# In Supabase SQL Editor, copy and run: supabase/rls-policies.sql

# Verify RLS is enabled:
SELECT table_name, rowsecurity
FROM information_schema.tables
WHERE table_schema = 'public';
```

### 3. Local Development

```bash
# Install dependencies
npm install

# Set up local environment
cp .env.example .env.local
# Edit .env.local with your values

# Run Prisma Studio to check database
npx prisma studio

# Start development server
npm run dev
```

### 4. Vercel Deployment

```bash
# Connect Git repository to Vercel Project
# Settings → Git Integration → Connect GitHub

# Set environment variables in Vercel Dashboard
# Settings → Environment Variables → Add all from list above

# Deploy
git push origin main
# Vercel automatically deploys on push

# Verify cron jobs
# Settings → Crons → Check both jobs are scheduled
```

### 5. Production Database Backup

```bash
# Create backup in Supabase Dashboard
# Database → Backups → Create manual backup

# Or use pg_dump:
pg_dump DATABASE_URL > backup-$(date +%Y%m%d).sql
```

## Monitoring & Logs

### Vercel Logs

```bash
# View deployment logs
vercel logs

# Real-time function logs
vercel logs --follow
```

### Supabase Logs

Dashboard → Logs → Check for errors, slow queries, RLS violations

### Cron Job Status

Vercel Dashboard → Crons → Check last run and status

## Troubleshooting Deployment

### Issue: 500 error on API endpoints

**Check:**
1. Environment variables are set in Vercel
2. Database connection string is correct
3. Service role key is valid

### Issue: RLS policies blocking requests

**Check:**
1. RLS policies are applied in Supabase
2. API is using correct authentication
3. Database URL points to correct project

### Issue: Cron jobs not running

**Check:**
1. Crons are defined in `vercel.json`
2. `CRON_SECRET` is set in Vercel env vars
3. Check Vercel Crons dashboard for failed runs

## Backup & Disaster Recovery

### Daily Automated Backups

- Supabase performs daily backups (configurable in Dashboard)
- Access backups: Database → Backups

### Manual Backup Procedure

```bash
# Create backup
pg_dump $DATABASE_URL > backup.sql

# Restore from backup
psql $DATABASE_URL < backup.sql
```

### Code Backups

- Git repository is the source of truth
- GitHub Actions should have automated backups
- Keep backup branches for major releases

## Security Considerations for Deployment

1. **Database Credentials** - Use Vercel's encrypted storage, never in code
2. **API Keys** - Rotate every 90 days
3. **Admin Credentials** - Use strong password + change initial password
4. **RLS Policies** - Verify all tables have RLS enabled
5. **Rate Limiting** - Consider adding at Vercel edge layer
6. **HTTPS** - Vercel provides for free
7. **CORS** - Configure if frontend/backend on different domains

## Documentation Files (IaC Reference)

| File | Purpose |
|------|---------|
| `.env.example` | Environment variable template |
| `vercel.json` | Vercel cron jobs & build config |
| `supabase/rls-policies.sql` | Row-Level Security policies |
| `prisma/schema.prisma` | Database schema |
| `prisma/migrations/` | Database migration history |
| `SECURITY_ARCHITECTURE.md` | Authentication & key separation |
| `ORDER_VALIDATION_SECURITY.md` | Server-side validation |
| `PDF_TO_IMAGE_SECURITY.md` | File handling security |

## Version Control Strategy

### Semantic Versioning
```bash
# Tag releases
git tag -a v1.0.0 -m "Initial production release"
git push origin v1.0.0
```

### Branch Strategy
- `main` → Production (protected, auto-deploy to Vercel)
- `develop` → Staging
- `feature/*` → Feature branches

## Infrastructure Costs

### Monthly Estimate (as of 2026)

| Service | Tier | Estimate |
|---------|------|----------|
| Vercel | Pro | $20-30 |
| Supabase | Pro | $25 (database) |
| Email (Resend) | Pro | $20-30 |
| Total | | $65-80 |

## Support & Documentation

- Vercel Docs: https://vercel.com/docs
- Supabase Docs: https://supabase.com/docs/guides/database/overview
- Next.js Docs: https://nextjs.org/docs
- Prisma Docs: https://www.prisma.io/docs/

## Contact - Infrastructure Team

For issues with deployment/infrastructure:
1. Check logs (Vercel → Logs, Supabase → Logs)
2. Verify environment variables
3. Check database connection
4. Review security documents above
