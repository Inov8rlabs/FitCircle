import { NextRequest } from 'next/server';
import { MobileAPIService } from '../services/mobile-api-service';

export interface AuthenticatedRequest extends NextRequest {
  user?: any;
  userId?: string;
}

/**
 * Verify Bearer token from Authorization header
 * Returns user object if valid, null otherwise
 */
import { createServerSupabase } from '@/lib/supabase-server';
import { createAdminSupabase } from '@/lib/supabase-admin';

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
      console.log('[verifyMobileAuth] Verifying Bearer token...');
      try {
        const user = await MobileAPIService.authenticateWithToken(token);
        return user;
      } catch (error) {
        console.error('[verifyMobileAuth] Error calling authenticateWithToken:', error);
      }
    }
  }

  // 2. Try Session Cookie (Web App)
  try {
    console.log('[verifyMobileAuth] Checking for session cookie...');
    const supabase = await createServerSupabase();
    const { data: { user: authUser }, error } = await supabase.auth.getUser();

    if (authUser && !error) {
      console.log('[verifyMobileAuth] Valid session cookie found for user:', authUser.id);

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

  console.log('[verifyMobileAuth] No valid auth found');
  return null;
}

/**
 * Require authentication - throw error if not authenticated
 */
export async function requireMobileAuth(request: NextRequest): Promise<any> {
  const authHeader = request.headers.get('Authorization');
  console.log('[requireMobileAuth] Authorization header:', authHeader ? 'present' : 'missing');

  const user = await verifyMobileAuth(request);

  console.log('[requireMobileAuth] User object:', user ? { id: user.id, email: user.email } : null);

  if (!user) {
    const error = new Error('Unauthorized');
    console.error('[requireMobileAuth] Authentication failed:', {
      hasAuthHeader: !!authHeader,
      authHeaderFormat: authHeader?.substring(0, 20),
    });
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
