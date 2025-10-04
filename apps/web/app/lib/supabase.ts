import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

// Browser client for client-side operations with cookie support
export const createBrowserSupabase = () => {
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

// Default browser client instance
export const supabase = createBrowserSupabase()