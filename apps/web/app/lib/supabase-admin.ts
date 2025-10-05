/**
 * Supabase admin client for service layer operations
 * This should only be used in API routes after authentication is verified
 */

import { createClient } from '@supabase/supabase-js';

export function createAdminSupabase() {
  // This uses the service role key which bypasses RLS
  // IMPORTANT: Only use in API routes after verifying user authentication
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}