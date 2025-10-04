/**
 * Supabase client configuration
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Create a Supabase client for browser/client-side usage
 */
export const createBrowserClient = () => {
  return createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: {
        'x-application-name': 'fitcircle-web',
      },
    },
  });
};

/**
 * Create a Supabase client for server-side usage with cookies
 */
export const createServerClientWithCookies = () => {
  const cookieStore = cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        try {
          cookieStore.set(name, value, options);
        } catch {
          // Cookies can only be set in a Server Component
        }
      },
      remove(name: string, options: any) {
        try {
          cookieStore.delete(name);
        } catch {
          // Cookies can only be removed in a Server Component
        }
      },
    },
  });
};

/**
 * Create a Supabase admin client with service role key
 * WARNING: This should only be used in secure server-side contexts
 */
export const createAdminClient = () => {
  return createSupabaseClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        'x-application-name': 'fitcircle-admin',
      },
    },
  });
};

/**
 * Create a Supabase client for API routes
 */
export const createApiClient = (accessToken?: string) => {
  const options: any = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        'x-application-name': 'fitcircle-api',
      },
    },
  };

  if (accessToken) {
    options.global.headers['Authorization'] = `Bearer ${accessToken}`;
  }

  return createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, options);
};

/**
 * Get Supabase client based on context
 */
export const getSupabaseClient = (context: 'browser' | 'server' | 'admin' | 'api', accessToken?: string) => {
  switch (context) {
    case 'browser':
      return createBrowserClient();
    case 'server':
      return createServerClientWithCookies();
    case 'admin':
      return createAdminClient();
    case 'api':
      return createApiClient(accessToken);
    default:
      throw new Error(`Invalid Supabase client context: ${context}`);
  }
};

/**
 * Supabase client singleton for browser usage
 */
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export const supabase = () => {
  if (typeof window === 'undefined') {
    // Server-side: always create a new client
    return createServerClientWithCookies();
  }

  // Client-side: use singleton
  if (!browserClient) {
    browserClient = createBrowserClient();
  }
  return browserClient;
};

/**
 * Admin client singleton (server-side only)
 */
let adminClient: ReturnType<typeof createAdminClient> | null = null;

export const supabaseAdmin = () => {
  if (typeof window !== 'undefined') {
    throw new Error('Admin client can only be used server-side');
  }

  if (!adminClient) {
    adminClient = createAdminClient();
  }
  return adminClient;
};