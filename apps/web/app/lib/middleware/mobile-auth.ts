import { type NextRequest } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';
import { createServerSupabase } from '@/lib/supabase-server';
import { runAfterResponse } from '@/lib/utils/after-response';

import { AppOpenService } from '../services/app-open-service';
import { MobileAPIService } from '../services/mobile-api-service';

/**
 * Retention fix 5: the apps send X-Client-Timezone on every request. A profile
 * still on the 'UTC' placeholder gets the device zone (after the response,
 * once per user per instance; never overwrites a real zone).
 */
function scheduleTimezoneBackfill(request: NextRequest, user: any): void {
  try {
    const tz = AppOpenService.pendingTimezoneBackfill(user, request);
    if (tz) runAfterResponse(() => AppOpenService.backfillTimezone(user.id, tz), 'timezone backfill');
  } catch {
    // never affects auth
  }
}

export interface AuthenticatedRequest extends NextRequest {
  user?: any;
  userId?: string;
}

/**
 * Verify Bearer token from Authorization header OR session cookie
 * Returns user object if valid, null otherwise
 */
export async function verifyMobileAuth(request: NextRequest): Promise<any | null> {
  const authHeader = request.headers.get('Authorization');

  // 1. Try Authorization Header (Mobile App)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[verifyMobileAuth] Verifying Bearer token...');
      }
      try {
        const user = await MobileAPIService.authenticateWithToken(token);
        if (user) scheduleTimezoneBackfill(request, user);
        return user;
      } catch (error) {
        console.error('[verifyMobileAuth] Error calling authenticateWithToken:', error);
      }
    }
  }

  // 2. Try Session Cookie (Web App)
  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('[verifyMobileAuth] Checking for session cookie...');
    }
    const supabase = await createServerSupabase();
    const { data: { user: authUser }, error } = await supabase.auth.getUser();

    if (authUser && !error) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[verifyMobileAuth] Valid session cookie found for user:', authUser.id);
      }

      // Fetch full profile to match mobile auth behavior
      const supabaseAdmin = createAdminSupabase();
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (profile) {
        return profile;
      }

      // Fallback if profile not found (shouldn't happen usually)
      return { id: authUser.id, email: authUser.email };
    }
  } catch (error) {
    console.error('[verifyMobileAuth] Cookie auth error:', error);
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[verifyMobileAuth] No valid auth found');
  }
  return null;
}

/**
 * Require authentication - throw error if not authenticated
 */
export async function requireMobileAuth(request: NextRequest): Promise<any> {
  const authHeader = request.headers.get('Authorization');
  if (process.env.NODE_ENV === 'development') {
    console.log('[requireMobileAuth] Authorization header:', authHeader ? 'present' : 'missing');
  }

  const user = await verifyMobileAuth(request);

  if (process.env.NODE_ENV === 'development') {
    console.log('[requireMobileAuth] User object:', user ? { id: user.id, email: user.email } : null);
  }

  if (!user) {
    const error = new Error('Unauthorized');
    if (process.env.NODE_ENV === 'development') {
      console.error('[requireMobileAuth] Authentication failed:', {
        hasAuthHeader: !!authHeader,
      });
    }
    throw error;
  }

  return user;
}

/**
 * Extract user ID from Bearer token
 */
export async function getUserIdFromToken(request: NextRequest): Promise<string | null> {
  const user = await verifyMobileAuth(request);
  return user?.id || null;
}
