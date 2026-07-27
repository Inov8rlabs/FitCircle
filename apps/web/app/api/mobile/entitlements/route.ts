import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { EntitlementService } from '@/lib/services/entitlement-service';

/**
 * GET /api/mobile/entitlements — the user's tier + per-feature allowed/requiredTier map.
 * Clients fetch after auth, cache, and re-fetch on app foreground; gated endpoints ALSO
 * enforce server-side (403 PREMIUM_REQUIRED). BODY_COMP_BUILD_CONTRACT §2.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const entitlements = await EntitlementService.getEntitlements(user.id);
    return NextResponse.json({ success: true, data: entitlements, meta: { requestTime: Date.now() - startTime }, error: null });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }
    console.error('[Mobile API] entitlements error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
