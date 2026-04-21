# Production Security Checklist

## Pre-Deployment Security Review

Before deploying to production, verify all items below are complete and tested.

---

## 1. Authentication & Authorization

### Middleware Protection
- [ ] `/admin` routes require Basic Auth
- [ ] `/dashboard` routes require Basic Auth  
- [ ] `/api/admin/*` routes require Basic Auth
- [ ] `/api/cron/*` routes require CRON_SECRET
- [ ] Test unauthorized access returns 401

### Admin Credentials
- [ ] `ADMIN_BASIC_USER` is NOT "admin"
- [ ] `ADMIN_BASIC_PASS` is strong password (12+ chars, mixed case/numbers/symbols)
- [ ] Credentials are NOT stored in code
- [ ] Credentials are in Vercel env vars as server-side only
- [ ] Initial password will be changed immediately after first login

### Session Management
- [ ] No session tokens stored in localStorage
- [ ] Cookies use `httpOnly` flag
- [ ] Cookies use `secure` flag (HTTPS only)
- [ ] Cookie SameSite policy is set to `Strict` or `Lax`

---

## 2. Supabase & Database Security

### Key Separation
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` has limited RLS permissions
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is used only on server-side
- [ ] Service role key is NOT exposed to frontend (check API responses)
- [ ] Service role key is stored in Vercel as server-only variable

### Row-Level Security (RLS)
- [ ] RLS is enabled on ALL 7 tables (confirmed in Supabase Dashboard)
- [ ] `supabase/rls-policies.sql` has been applied to production database
- [ ] Verification queries confirm policies are active:
  ```sql
  SELECT table_name, rowsecurity FROM information_schema.tables WHERE table_schema = 'public';
  ```
- [ ] Test RLS:
  - Anon key can read published menu items only
  - Anon key cannot read orders/reservations
  - Service role key can read/write all tables
- [ ] Public tables (orders, reservations) have explicit deny for SELECT

### Database Encryption
- [ ] Supabase project has SSL/TLS enabled
- [ ] DATABASE_URL uses encrypted connection (sslmode=require)
- [ ] Database backups are enabled in Supabase Dashboard

---

## 3. API Security

### Input Validation
- [ ] `/api/orders` validates all fields (items, total, customer info)
- [ ] `/api/orders` rejects negative quantities
- [ ] `/api/orders` rejects zero/negative totals
- [ ] `/api/orders` validates email format
- [ ] `/api/orders` sanitizes text inputs (no XSS payloads)
- [ ] File upload endpoints reject suspicious mime types

### Price Integrity
- [ ] `/api/orders` fetches menu items from database
- [ ] `/api/orders` recalculates totals server-side
- [ ] `/api/orders` rejects if client total ≠ calculated total
- [ ] Price mismatch rejection logged for audit trail
- [ ] Test: Submit order with tampered price → 400 response

### Rate Limiting
- [ ] `/api/orders` has rate limit (e.g., 10 requests/min per IP)
- [ ] `/api/pdf-to-image` has rate limit (e.g., 5 requests/min per user)
- [ ] `/api/login` [if exists] has rate limit (e.g., 3 attempts/5 mins)
- [ ] Rate limit headers are returned (RateLimit-Limit, RateLimit-Remaining)

### Path Traversal Prevention
- [ ] `/api/pdf-to-image` requires authentication
- [ ] `/api/pdf-to-image` validates filePath with `path.resolve()`
- [ ] `/api/pdf-to-image` checked that resolved path is within allowed base directory
- [ ] `/api/pdf-to-image` rejects symbolic links
- [ ] Test path traversal attempts:
  - `../../../etc/passwd` → 403
  - `/etc/passwd` → 403
  - Absolute paths outside.public/photos` → 403
- [ ] File size limit is enforced (currently 50 MB)
- [ ] Navigation timeout is set (currently 30s)

---

## 4. Environment Variables & Secrets

### Configuration
- [ ] `.env` is in `.gitignore` (never committed)
- [ ] `.env.example` exists with template but NO real values
- [ ] All production variables are set in Vercel Dashboard
- [ ] No secrets in `vercel.json`, `next.config.js`, or package.json

### Server-Side Only Variables
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is server-only
- [ ] `DATABASE_URL` is server-only
- [ ] `ADMIN_BASIC_USER` and `ADMIN_BASIC_PASS` are server-only
- [ ] `EMAIL_API_KEY` is server-only
- [ ] `CRON_SECRET` is server-only

### Public Variables (Browser-Safe)
- [ ] `NEXT_PUBLIC_SUPABASE_URL` is safe (project URL only)
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` has limited RLS permissions
- [ ] No other `NEXT_PUBLIC_*` variables contain secrets

---

## 5. Cron Jobs & Scheduled Tasks

### Configuration
- [ ] Both cron jobs are defined in `vercel.json`
  - `cancel-expired-orders` at 00:00 UTC
  - `delete-old-histories` at 01:00 UTC
- [ ] `CRON_SECRET` is configured in Vercel as server-only
- [ ] Cron routes require `CRON_SECRET` verification
- [ ] Failed cron jobs send alert notifications

### Testing
- [ ] Cron jobs can be triggered manually via Vercel Dashboard
- [ ] Verify database queries execute correctly
- [ ] Check logs for any errors or skipped records
- [ ] Monitor cron job success rate (target: 100%)

---

## 6. Data Protection & Privacy

### Encryption
- [ ] Sensitive data (passwords, tokens) hashed with bcrypt/argon2
- [ ] Database connection uses TLS/SSL
- [ ] HTTPS required (enforced at middleware or next.config)
- [ ] Sensitive API responses do not log full data

### Data Retention
- [ ] Order history retention policy is set (e.g., 1 year)
- [ ] Deleted data is purged from backups after retention period
- [ ] GDPR/data deletion requests have process defined

### Audit Logging
- [ ] Security events are logged:
  - [ ] Failed authentication attempts
  - [ ] Order price mismatches
  - [ ] Path traversal attempts
  - [ ] Rate limit breaches
- [ ] Logs are centralized (CloudWatch, Datadog, etc.) - NOT disk only
- [ ] Logs are retained for 90+ days

---

## 7. Error Handling & Information Disclosure

### Generic Error Messages
- [ ] 400 errors don't reveal system details
- [ ] 500 errors are logged but show generic message to user
- [ ] Stack traces are NOT exposed in production responses
- [ ] SQL errors are logged but not displayed (prevent SQLi info leak)

### Logging
- [ ] Sensitive data (passwords, API keys) are NOT logged
- [ ] Error logs are sent to centralized system
- [ ] Production logs are NOT visible in browser console

---

## 8. HTTPS & Transport Security

### Configuration
- [ ] All endpoints require HTTPS (http://... redirects to https://...)
- [ ] HSTS header is set (Strict-Transport-Security)
- [ ] HSTS preload is enabled for main domain
- [ ] Certificate is valid and not self-signed
- [ ] TLS version ≥ 1.2

### Testing
```bash
curl -I https://your-domain.com
# Check for:
# Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
# Content-Security-Policy
# X-Content-Type-Options: nosniff
# X-Frame-Options: SAMEORIGIN
```

---

## 9. CORS & Allowed Origins

### Configuration
- [ ] CORS is configured for intended clients only
- [ ] Wildcard `*` is NOT used in production
- [ ] Allowed origins:
  - [ ] Main domain (e.g., https://restaurant.com)
  - [ ] Admin domain (e.g., https://admin.restaurant.com)
  - [ ] Any third-party integrations (LINE, etc.)
- [ ] Credentials can be sent cross-origin if needed

### Testing
```bash
curl -H "Origin: https://attacker.com" https://your-domain.com/api/orders
# Should NOT return Access-Control-Allow-Origin header for attacker domain
```

---

## 10. Dependencies & Vulnerabilities

### Scanning
- [ ] Run `npm audit` - no high/critical vulnerabilities
- [ ] Check outdated packages: `npm outdated`
- [ ] Review dependency licenses
- [ ] No unmaintained dependencies

### Testing
- [ ] All dependencies from package.json are needed (no unused)
- [ ] Dependencies are pinned to specific versions (not ranges)
- [ ] Lock file (package-lock.json) is committed

---

## 11. Testing & Quality Assurance

### Security Testing
- [ ] Admin routes tested with wrong credentials → 401
- [ ] API endpoints tested with invalid data → 400/422
- [ ] Path traversal attempts blocked → 403
- [ ] Rate limits prevent brute force → 429
- [ ] RLS prevents unauthorized data access

### Functional Testing
- [ ] Order creation works end-to-end
- [ ] Email notifications send correctly
- [ ] Cron jobs execute without errors
- [ ] Dashboard displays correct order data
- [ ] PDF conversion works for valid files

### Performance Testing
- [ ] Database queries run in <100ms (check Supabase Analytics)
- [ ] Page load time <2 seconds
- [ ] API response time <500ms
- [ ] Cron jobs complete within timeout

---

## 12. Monitoring & Alerting

### Metrics to Monitor
- [ ] API error rate (target: <1%)
- [ ] Cron job success rate (target: 100%)
- [ ] Database response time (target: <100ms)
- [ ] Authentication failure rate
- [ ] Failed RLS policy checks

### Alerts
- [ ] Alert on 401 (failed auth) >10 times/hour
- [ ] Alert on 4xx errors >5%
- [ ] Alert on 5xx errors >1%
- [ ] Alert on cron job failure
- [ ] Alert on database connection failure

### Logging
- [ ] All errors sent to logging service
- [ ] Security events tagged and searchable
- [ ] Logs include request ID for tracing

---

## 13. Documentation

### Deployment
- [ ] This file (security checklist) is in repository
- [ ] Deployment procedures documented (DEPLOYMENT_SETUP.md)
- [ ] Environment variables documented (.env.example)
- [ ] RLS policies documented (supabase/rls-policies.sql)
- [ ] Security architecture documented (SECURITY_ARCHITECTURE.md)

### Runbooks
- [ ] Incident response procedure documented
- [ ] Database backup/restore procedure documented
- [ ] How to rotate credentials documented
- [ ] How to patch vulnerabilities documented

---

## 14. Final Approval & Sign-Off

### Code Review
- [ ] Security code review completed
- [ ] No hardcoded secrets found
- [ ] No vulnerable dependencies
- [ ] All security fixes implemented

### Leadership Approval
- [ ] Security team approved deployment
- [ ] Product team verified functionality
- [ ] Database team verified backups
- [ ] DevOps team verified infrastructure

### Post-Deployment
- [ ] Application deployed to production
- [ ] All endpoints tested from production URL
- [ ] Monitoring dashboards active
- [ ] On-call engineer briefed on system
- [ ] Incident playbook ready

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Security Lead | | | |
| Developer | | | |
| Infrastructure | | | |
| Product Manager | | | |

---

## Notes

- This checklist should be completed before EVERY production deployment
- Use this as a template for `vercel.json` → Deployments section
- Update checklist as new security features are added
- Review quarterly for items that need refreshing
- Keep previous checklists for audit trail

---

## Related Documents

- [SECURITY_ARCHITECTURE.md](./SECURITY_ARCHITECTURE.md)
- [ORDER_VALIDATION_SECURITY.md](./ORDER_VALIDATION_SECURITY.md)
- [PDF_TO_IMAGE_SECURITY.md](./PDF_TO_IMAGE_SECURITY.md)
- [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md)
- [supabase/rls-policies.sql](./supabase/rls-policies.sql)
