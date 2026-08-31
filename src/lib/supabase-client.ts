import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from "@/lib/env-public";

/**
 * Supabase client for browser/client-side operations
 * Uses NEXT_PUBLIC_* keys (anon key) - Protected by RLS in Supabase
 */
const supabaseUrl = publicEnv.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
