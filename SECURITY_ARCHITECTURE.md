# Supabase Security Architecture

## Overview
This document describes the security measures implemented for Supabase client usage in the Bistro Reservation system.

## Key Principles

### 1. Client vs. Server Key Separation
- **anon key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`): Used only in browser/client-side code
- **service role key** (`SUPABASE_SERVICE_ROLE_KEY`): Used only on server-side (API routes, cron jobs)
- **Never expose service role key to clients**

### 2. Supabase Client Modules

#### `supabase-client.ts`
- Uses anonymous key
- For browser/client-side operations only
- Protected by Row-Level Security (RLS) policies
- Example: Fetching public menu items, photos

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

All API routes using `supabaseServer` MUST include one of:
1. **Basic authentication** (`isAuthorized()`) - For admin/dashboard routes
2. **CRON_SECRET token** verification - For scheduled tasks
3. **User session validation** - For user-specific operations

**Example:**
```typescript
import { supabaseServer } from '@/lib/supabase-server'
import { isAuthorized } from '@/lib/basic-auth'

export async function GET(request: NextRequest) {
  // 1. Always authenticate first
  if (!isAuthorized(request)) {
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
- Menu page - Public queries with anon key
- Photos page - Public queries with anon key

### Server-Side (Service Role Key)
- `/src/app/api/dashboard/orders/route.ts` - Protected by Basic Auth
- `/src/app/api/dashboard/bank-account/route.ts` - Protected by Basic Auth
- `/src/app/api/orders/route.ts` - Public order creation endpoint
- `/src/app/api/crons/delete-old-histories/route.ts` - Protected by CRON_SECRET
- `/src/app/api/crons/cancel-expired-orders/route.ts` - Protected by CRON_SECRET

## RLS Policies (Required in Supabase Dashboard)

### orders table
```sql
-- Public can create orders (with RLS)
CREATE POLICY "allow_insert_orders" ON "public"."orders"
  FOR INSERT TO anon
  WITH CHECK (true);

-- Only admin can read/update (via service role in API)
CREATE POLICY "admin_orders_access" ON "public"."orders"
  FOR ALL TO authenticated
  USING (auth.jwt()->>'role' = 'authenticated');
```

### bank_account table
```sql
-- No anon access (only via admin API with service role)
CREATE POLICY "admin_bank_account_access" ON "public"."bank_account"
  FOR ALL TO authenticated
  USING (auth.jwt()->>'role' = 'admin');
```

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
- [ ] Configure RLS policies in Supabase dashboard
- [ ] Test all API endpoints with authentication
- [ ] Verify cron jobs run with correct CRON_SECRET

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
