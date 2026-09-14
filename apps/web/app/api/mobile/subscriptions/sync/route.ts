import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { EntitlementService } from '@/lib/services/entitlement-service';
import { SubscriptionService } from '@/lib/services/subscription-service';

/**
 * POST /api/mobile/subscriptions/sync — pull-based fallback for the RevenueCat webhook.
 *
 * After a purchase or restore the apps poll GET /api/mobile/entitlements waiting for
 * RevenueCat's webhook to land. If it is slow or dropped, this endpoint fetches the
 * user's subscriber record from RevenueCat's REST API right now, updates the profile,
 * and returns the fresh entitlements (same `data` shape as GET /api/mobile/entitlements).
 *
 * `meta.synced` is false when REVENUECAT_SECRET_API_KEY is not configured or the
 * RevenueCat call failed; `data` is then simply the current entitlements, so a client
 * can always render what it gets back.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);

    let synced = false;
    if (process.env.REVENUECAT_SECRET_API_KEY) {
      try {
        await SubscriptionService.syncFromRevenueCat(user.id);
        synced = true;
      } catch (err: any) {
        console.warn(`[Mobile API] subscriptions/sync: RevenueCat sync failed for ${user.id}:`, err?.message);
      }
    }

    const entitlements = await EntitlementService.getEntitlements(user.id);
    return NextResponse.json({
      success: true,
      data: entitlements,
      meta: { synced, requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }
    console.error('[Mobile API] subscriptions/sync error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
