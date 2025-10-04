import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

// Browser client for client-side operations with cookie support
export const createBrowserSupabase = () => {
  // Only access document in browser environment
  if (typeof window === 'undefined') {
    throw new Error('createBrowserSupabase can only be called in browser environment')
  }

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          const value = `; ${document.cookie}`;
          const parts = value.split(`; ${name}=`);
          if (parts.length === 2) return parts.pop()?.split(';').shift();
        },
        set(name: string, value: string, options: any) {
          let cookie = `${name}=${value}`;

          if (options?.maxAge) {
            cookie += `; max-age=${options.maxAge}`;
          }
          if (options?.path) {
            cookie += `; path=${options.path}`;
          }
          if (options?.domain) {
            cookie += `; domain=${options.domain}`;
          }
          if (options?.sameSite) {
            cookie += `; samesite=${options.sameSite}`;
          }
          if (options?.secure) {
            cookie += '; secure';
          }

          document.cookie = cookie;
        },
        remove(name: string, options: any) {
          this.set(name, '', { ...options, maxAge: 0 });
        },
      },
    }
  )
}

// Admin client for server-side operations (with service role key)
export const createAdminSupabase = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}

// Lazy-initialized browser client instance
// This ensures it's only created when actually used in browser context
let _supabase: ReturnType<typeof createBrowserClient> | null = null

/**
 * Get the browser Supabase client instance
 * Only use this in client-side code (components with 'use client')
 * For server-side operations, use createServerSupabase() or createAdminSupabase()
 */
export function getSupabase() {
  if (typeof window === 'undefined') {
    throw new Error('getSupabase() can only be called in browser environment. Use createServerSupabase() or createAdminSupabase() for server-side operations.')
  }

  if (!_supabase) {
    _supabase = createBrowserSupabase()
  }
  return _supabase
}

// For backward compatibility - lazy getter that only initializes in browser
export const supabase = new Proxy({} as ReturnType<typeof createBrowserClient>, {
  get(target, prop) {
    return getSupabase()[prop as keyof ReturnType<typeof createBrowserClient>]
  }
})