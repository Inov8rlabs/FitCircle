import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { MobileAPIService, JWTPayload } from '../services/mobile-api-service';

/**
 * Proactive Token Refresh Middleware
 *
 * Checks if the current access token will expire within 7 days.
 * If yes, generates new token pair and adds them to response headers.
 *
 * iOS client should check for these headers on every API response:
 * - X-New-Access-Token: New access token (if refresh needed)
 * - X-New-Refresh-Token: New refresh token (if refresh needed)
 * - X-New-Expires-At: New expiry timestamp (if refresh needed)
 *
 * Usage in API routes:
 * ```typescript
 * import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
 *
 * export async function GET(request: NextRequest) {
 *   const user = await requireMobileAuth(request);
 *
 *   // ... your API logic ...
 *
 *   let response = NextResponse.json({ data: ... });
 *   response = await addAutoRefreshHeaders(request, response, user);
 *   return response;
 * }
 * ```
 */

const REFRESH_THRESHOLD_DAYS = 7;
const REFRESH_THRESHOLD_SECONDS = REFRESH_THRESHOLD_DAYS * 24 * 60 * 60;

/**
 * Check if token expires within threshold and add refresh headers if needed
 */
export async function addAutoRefreshHeaders(
  request: NextRequest,
  response: NextResponse,
  user: any
): Promise<NextResponse> {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return response;
    }

    const token = authHeader.substring(7);

    // Decode token without verification (we already verified it in requireMobileAuth)
    const decoded = jwt.decode(token) as JWTPayload | null;

    if (!decoded || !decoded.exp) {
      return response;
    }

    // Check if token expires within threshold
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = decoded.exp - now;

    if (expiresIn <= REFRESH_THRESHOLD_SECONDS) {
      console.log(`[AutoRefresh] Token expires in ${expiresIn}s, generating new tokens for user ${user.id}`);

      // Generate new token pair
      const tokens = await MobileAPIService.generateTokens(user.id, user.email);

      // Add headers to response
      response.headers.set('X-New-Access-Token', tokens.access_token);
      response.headers.set('X-New-Refresh-Token', tokens.refresh_token);
      response.headers.set('X-New-Expires-At', tokens.expires_at.toString());

      console.log(`[AutoRefresh] New tokens added to response headers for user ${user.id}`);
    }

    return response;
  } catch (error) {
    console.error('[AutoRefresh] Error checking token expiry:', error);
    // Don't fail the request, just return original response
    return response;
  }
}

/**
 * Extract token expiry information for debugging
 */
export function getTokenExpiryInfo(token: string): {
  expiresAt: number;
  expiresIn: number;
  willExpireSoon: boolean;
} | null {
  try {
    const decoded = jwt.decode(token) as JWTPayload | null;

    if (!decoded || !decoded.exp) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresIn = decoded.exp - now;

    return {
      expiresAt: decoded.exp,
      expiresIn,
      willExpireSoon: expiresIn <= REFRESH_THRESHOLD_SECONDS,
    };
  } catch (error) {
    return null;
  }
}
