# Security Quick Reference Guide

## For Developers

### Before Coding
- [ ] Read [SECURITY_ARCHITECTURE.md](./SECURITY_ARCHITECTURE.md) to understand key separation
- [ ] Never hardcode API keys, use environment variables
- [ ] All environment variables must be in `.env.example` (without values)

### When Accessing Database
```typescript
// ✅ Server-side (API routes, server actions)
import { supabaseServer } from '@/lib/supabase-server'
const data = await supabaseServer.from('table').select()

// ❌ WRONG: Client-side service role key
import { supabaseServer } from '@/lib/supabase-server'  // Don't use in components!
```

### When Handling User Input
```typescript
// ✅ Validate on server-side
const validated = await validateUserInput(body)

// ❌ WRONG: Trust client-provided data
const order = await saveOrder(req.body)  // Could be tampered!
```

### When Handling Files
```typescript
// ✅ Validate file path
const allowedDir = path.resolve(process.cwd(), "public/photos")
const safePath = path.resolve(filePath)
if (!safePath.startsWith(allowedDir)) throw new Error("Access denied")

// ❌ WRONG: Trust user filePath
const pdf = await fs.readFile(req.query.filePath)  // Path traversal!
```

### Testing Security Fixes
```bash
# Test authentication
curl -I http://localhost:3000/dashboard  # Should redirect to /admin login

# Test price validation
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"items":[{"id":"1","quantity":1}],"total":0}'
# Should return 400 if price mismatch

# Test path traversal protection
curl http://localhost:3000/api/pdf-to-image?filePath=../../../etc/passwd
# Should return 401 (no auth) or 403 (path denied)
```

---

## For DevOps / Infrastructure

### Deployment Checklist Quick Version

1. **Secrets Management**
   ```bash
   # Verify .env is NOT in Git
   git ls-files | grep "\.env$"  # Should return nothing
   
   # Set Vercel env vars
   vercel env pull  # Pulls from Vercel project
   ```

2. **Database Setup**
   ```bash
   # Apply RLS policies
   # In Supabase Dashboard → SQL Editor:
   # Copy supabase/rls-policies.sql and execute
   
   # Run migrations
   npx prisma migrate deploy
   ```

3. **Environment Variables**
   - [ ] `DATABASE_URL` - Server-only ✅
   - [ ] `SUPABASE_SERVICE_ROLE_KEY` - Server-only ✅
   - [ ] `ADMIN_BASIC_USER` - Server-only ✅
   - [ ] `ADMIN_BASIC_PASS` - Server-only ✅
   - [ ] `CRON_SECRET` - Server-only ✅
   - [ ] `NEXT_PUBLIC_SUPABASE_URL` - Public OK
   - [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Public OK

4. **Monitoring**
   ```bash
   # Check logs
   vercel logs -n 100
   
   # Confirm cron jobs are scheduled
   # Vercel Dashboard → Crons
   ```

### Environment Variable Checklist

**Server-Only Variables** (Never visible to client):
- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_BASIC_USER`
- `ADMIN_BASIC_PASS`
- `EMAIL_API_KEY`
- `CRON_SECRET`
- `LINE_CHANNEL_SECRET`

**Public Variables** (OK to expose):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**How to Verify**: Vercel Dashboard → Settings → Environment Variables → Check "Environments" column

---

## For Security Team

### Vulnerability Assessment Reference

| Vulnerability | CWE | Status | Evidence |
|----------------|-----|--------|----------|
| Credential Exposure | CWE-798, CWE-542 | ✅ FIXED | `.gitignore` + `.env.example` |
| Missing Authentication | CWE-306 | ✅ FIXED | `/dashboard` in middleware |
| Weak Cryptography | CWE-732 | ✅ FIXED | supabase-client/server split |
| Input Validation | CWE-347 | ✅ FIXED | Price validation + Prisma checks |
| Path Traversal | CWE-22, CWE-61 | ✅ FIXED | path.resolve() + boundary checks |
| RLS Not Tracked | CWE-693 | ✅ FIXED | supabase/rls-policies.sql |

### Audit Commands

```bash
# Check for secrets in code
grep -r "SUPABASE_SERVICE_ROLE_KEY\|DATABASE_URL\|APIKey" src/ --exclude-dir=node_modules

# Verify .gitignore
cat .gitignore | grep -E "\.env|node_modules|\.next"

# Check RLS status
# In Supabase SQL Editor:
SELECT table_name, rowsecurity FROM information_schema.tables WHERE table_schema = 'public';

# Check dependencies for vulnerabilities
npm audit

# Verify no public APIs missing auth
grep -r "NextResponse.json" src/app/api/ | grep -v "middleware\|authorized"
```

### Security Documentation

| Document | Audience | Length |
|----------|----------|--------|
| [SECURITY_ARCHITECTURE.md](./SECURITY_ARCHITECTURE.md) | Architects | 168 lines |
| [ORDER_VALIDATION_SECURITY.md](./ORDER_VALIDATION_SECURITY.md) | Developers | 220 lines |
| [PDF_TO_IMAGE_SECURITY.md](./PDF_TO_IMAGE_SECURITY.md) | DevOps | 280 lines |
| [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md) | DevOps/SRE | 340 lines |
| [PRODUCTION_SECURITY_CHECKLIST.md](./PRODUCTION_SECURITY_CHECKLIST.md) | Release Manager | 420 lines |
| [SECURITY_AUDIT_SUMMARY.md](./SECURITY_AUDIT_SUMMARY.md) | Management | 557 lines |

---

## Incident Response Quick Reference

### If Credentials are Leaked

```bash
# 1. Immediately rotate credentials
vercel env rm SUPABASE_SERVICE_ROLE_KEY
vercel env rm DATABASE_URL
# Re-add new values

# 2. Check logs for misuse
vercel logs | grep "401\|403\|suspicious"

# 3. Review recent orders
# In Supabase: SELECT * FROM orders WHERE created_at > NOW() - interval '1 hour'

# 4. Reset database if needed
# Restore from backup: db → Backups → Restore
```

### If Performance Degrades

```bash
# 1. Check database query performance
# Supabase Dashboard → Performance tab

# 2. Check if rate limiting is triggering
# Look for 429 responses in logs

# 3. Check cron job status
# Vercel Dashboard → Crons

# 4. Check function timeout
# Vercel Dashboard → Deployments → Logs
```

### If Authentication Fails

```bash
# 1. Verify credentials are correct
echo $ADMIN_BASIC_USER
echo $ADMIN_BASIC_PASS

# 2. Check middleware is protecting routes
curl -I http://localhost:3000/dashboard
# Should show: Location: /admin (redirect to login)

# 3. Check Basic Auth header format
curl -H "Authorization: Basic $(echo -n 'user:pass' | base64)" \
  http://localhost:3000/dashboard
```

---

## Common Issues & Quick Fixes

### Issue: 401 Unauthorized on /dashboard
**Cause**: Missing or incorrect Basic Auth header  
**Fix**: Check that Authorization header is set with correct credentials
```bash
# Test with credentials
curl -u admin:yourpassword http://localhost:3000/api/dashboard/orders
```

### Issue: 400 Order validation failed
**Cause**: Order total doesn't match menu prices  
**Fix**: This is EXPECTED - prevents price tampering. Verify client is using correct prices.

### Issue: 403 Access denied on /api/pdf-to-image?filePath=...
**Cause**: File path is outside `public/photos` directory or is a symlink  
**Fix**: Move file to `public/photos` directory and remove symlinks

### Issue: Cron jobs not running
**Cause**: `CRON_SECRET` not set in Vercel  
**Fix**: 
```bash
vercel secrets, look for CRON_SECRET
vercel env add CRON_SECRET your-secret-token-here
```

### Issue: Database connection refused
**Cause**: DATABASE_URL is incorrect or database is down  
**Fix**:
```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"

# Check Supabase status
# Supabase Dashboard → Status
```

---

## Code Review Checklist

When reviewing code for security, check:

### Authentication
- [ ] New routes that access data have `isAuthorized()` check
- [ ] Admin functions use authentication middleware
- [ ] API key access is checked (CRON_SECRET for cron routes)

### Data Handling
- [ ] Server-side recalculation for business-critical values (prices, totals)
- [ ] Input validation on all user-submitted data
- [ ] SQL queries use parameterized queries (Prisma/Supabase handles this)

### File Operations
- [ ] File paths are normalized with `path.resolve()`
- [ ] Boundary checks prevent directory traversal
- [ ] Symlinks are detected and rejected
- [ ] File size limits are enforced

### Secrets
- [ ] No API keys in code
- [ ] No hardcoded passwords
- [ ] Environment variables used for all secrets
- [ ] Server-only variables are not exposed to client

### Dependencies
- [ ] No new `npm install` without security review
- [ ] `npm audit` passes (no high/critical vulns)
- [ ] Dependencies are pinned to specific versions

---

## Monitoring Dashboard Metrics

Key metrics to watch:

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| 401 errors/hour | > 10 | Check auth logs, possible attack |
| 400 errors/hour | > 50 | Check order validation, prices correct? |
| API latency | > 1000ms | Check database performance |
| Cron failures | Any | Immediate investigation required |
| 503 errors | Any | Service degradation, investigate |

---

## Password Management

### For Admin Credentials

```bash
# Generate strong password (20+ chars)
openssl rand -base64 24

# Or use a password manager: 1Password, LastPass, Bitwarden

# Never share via:
❌ Slack
❌ Email
❌ Git
❌ Discord

# Only share via:
✅ 1Password / Password Manager
✅ Encrypted chat (Signal, WhatsApp)
✅ Direct conversation with sign-off
```

### Rotation Schedule

- [ ] Admin password: Every 90 days
- [ ] API keys: Every 90 days
- [ ] Database password: Every 180 days
- [ ] SSH keys: Every 1 year

---

## Links & References

**Security Documentation**:
- [SECURITY_ARCHITECTURE.md](./SECURITY_ARCHITECTURE.md)
- [PRODUCTION_SECURITY_CHECKLIST.md](./PRODUCTION_SECURITY_CHECKLIST.md)
- [SECURITY_AUDIT_SUMMARY.md](./SECURITY_AUDIT_SUMMARY.md)

**External References**:
- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [Vercel Security](https://vercel.com/docs/security)
- [Supabase Security](https://supabase.com/docs/guides/security/overview)
- [Next.js Security](https://nextjs.org/docs/advanced-features/security-headers)

**Internal Contacts**:
- Security: Open private security issue
- DevOps: Check infrastructure documentation
- Architecture: Review SECURITY_ARCHITECTURE.md

---

## Version History

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | Feb 2026 | Initial security hardening guidance |

*Last Updated: February 2026*  
*Next Review: May 2026*
