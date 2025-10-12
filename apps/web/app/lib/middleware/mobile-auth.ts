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
export async function verifyMobileAuth(request: NextRequest): Promise<any | null> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    console.log('[verifyMobileAuth] No Authorization header');
    return null;
  }

  // Check for Bearer token format
  if (!authHeader.startsWith('Bearer ')) {
    console.log('[verifyMobileAuth] Invalid Authorization header format');
    return null;
  }

  // Extract token
  const token = authHeader.substring(7);

  if (!token) {
    console.log('[verifyMobileAuth] Empty token after Bearer prefix');
    return null;
  }

  console.log('[verifyMobileAuth] Token extracted, length:', token.length);

  // Verify token and get user
  try {
    const user = await MobileAPIService.authenticateWithToken(token);
    console.log('[verifyMobileAuth] authenticateWithToken returned:', user ? 'user object' : 'null');
    return user;
  } catch (error) {
    console.error('[verifyMobileAuth] Error calling authenticateWithToken:', error);
    return null;
  }
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
