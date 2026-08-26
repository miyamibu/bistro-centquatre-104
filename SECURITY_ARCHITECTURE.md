# Supabase Security Architecture

## Overview
This document describes the security measures implemented for Supabase client usage in the Bistro Reservation system.

## Key Principles

### 1. Client vs. Server Key Separation
- **anon key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`): May initialize browser-side Supabase SDK features, but has no direct table access
- **service role key** (`SUPABASE_SERVICE_ROLE_KEY`): Used only by server-side Supabase API operations that require it
- **runtime database role**: Used by Prisma with least-privilege grants and no `DELETE` / `TRUNCATE` on protected business and audit tables
- **Never expose service-role or database credentials to clients**

### 2. Supabase Client Modules

#### `supabase-client.ts`
- Uses anonymous key
- For browser/client-side Supabase SDK operations only
- RLS deny-all policies prevent `anon` and `authenticated` from reading or mutating application tables directly
- Public menu, photo, reservation, and order data flows use application routes or server-rendered code

#### `supabase-server.ts`
- Uses service role key
- For server-side operations only
- Bypasses RLS rules (use with caution)
- Example: API routes, scheduled cron jobs
- **CRITICAL**: Always guard with additional authentication checks

#### `supabase.ts`
- Re-exports both clients for backward compatibility
- **DEPRECATED**: Import directly from `supabase-client` or `supabase-server`

### 3. API Route Authentication

All API routes using the Supabase service role client MUST include one of:
1. **Individual Supabase Auth session** (`getStaffAuth()`) - For admin/dashboard routes
2. **CRON_SECRET token** verification - For scheduled tasks
3. **Route-scoped bearer token** verification - For backup export
4. **User session validation** - For user-specific operations

**Example:**
```typescript
import { supabaseServer } from '@/lib/supabase-server'
import { getStaffAuth } from '@/lib/staff-auth'

export async function GET(request: NextRequest) {
  // 1. Always authenticate first
  if (!(await getStaffAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Then use service role key
  const { data, error } = await supabaseServer.from('sensitive_table').select('*')
  // ...
}
```

## Current Implementation

### Client-Side (RLS Protected)
- `/src/app/dashboard/orders/orders-client.tsx` - Uses API endpoints (not direct Supabase)
- Menu and photo pages do not depend on direct anonymous table access
- Reservation and order forms submit only to application API routes

### Server-Side (Service Role Key)
- `/src/app/api/dashboard/orders/route.ts` - Protected by individual Supabase Auth user + role + MFA
- `/src/app/api/dashboard/bank-account/route.ts` - Protected by individual Supabase Auth user + role + MFA
- `/src/app/api/orders/route.ts` - Public order creation endpoint
- `/src/app/api/crons/delete-old-histories/route.ts` - Protected by CRON_SECRET
- `/src/app/api/crons/cancel-expired-orders/route.ts` - Protected by CRON_SECRET

## RLS Policies

The canonical policy source is `supabase/rls-policies.sql`.

1. RLS is enabled on every application table covered by `supabase/verify.sql`.
2. `anon` and `authenticated` are deny-all for direct table operations.
3. Browser clients call application API routes; no public table-insert policy is used.
4. Server-side Supabase operations use the service-role key only after the route's own authentication, authorization, CSRF/origin, rate-limit, and validation checks.
5. Prisma uses a dedicated runtime role with the minimum table privileges required by the app. Protected reservation, audit, scheduler, and token tables deny direct `DELETE` and `TRUNCATE` to that role.
6. Narrow cleanup operations use bounded `SECURITY DEFINER` functions whose `EXECUTE` privilege is granted only to the runtime role.

After applying migrations and `supabase/rls-policies.sql`, run:

```bash
psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f supabase/verify.sql
```

Do not deploy when any assertion fails. The verification script checks required tables, RLS, deny-all policies, foreign keys, runtime grants, forbidden destructive grants, and restricted cleanup-function execution.

## Environment Variables

### Required in `.env` (server-side only)
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # ⚠️ SECRET - never expose!
CRON_SECRET=your-cron-secret-token
```

### Safe to expose in `.env.local` (or build-time)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### MUST be server-side only
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`

## Migration Checklist

- [x] Created `supabase-client.ts` for client-side operations
- [x] Created `supabase-server.ts` for server-side operations
- [x] Updated all API routes to use `supabaseServer`
- [x] Updated all cron routes to use `supabaseServer`
- [x] Verified client components use API endpoints (not direct Supabase)
- [x] Updated `.env.example` with all required variables
- [x] Store canonical RLS policies in `supabase/rls-policies.sql`
- [x] Add executable assertions in `supabase/verify.sql`
- [x] Require individual staff authentication, role, and MFA for protected staff routes
- [x] Require `CRON_SECRET` bearer authentication for cron routes
- [ ] Re-run migrations, RLS assertions, authenticated endpoint tests, and cron canaries against each release target before production promotion

## Best Practices

1. **Always separate keys**: Never mix anon and service role keys
2. **Authenticate API routes**: Always check authorization before data access
3. **Use RLS policies**: Even though service role bypasses them, enable RLS for defense-in-depth
4. **Rotate secrets regularly**: Update CRON_SECRET and regenerate keys periodically
5. **Audit access logs**: Review Supabase audit logs for suspicious activity
6. **Never log secrets**: Ensure service role key never appears in logs

## References

- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Supabase API Keys](https://supabase.com/docs/guides/api/api-keys)
- [API Security Best Practices](https://supabase.com/docs/guides/api#best-practices)
