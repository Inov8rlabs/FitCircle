/**
 * GET /api/mobile/feature-flags/[name] - Is a named feature flag on for the current user?
 *
 * Same response shape as /api/mobile/food-log/feature-flag:
 *   { success, data: { enabled, reason, access_level }, meta, error }
 *
 * Only flags in MOBILE_FEATURE_FLAGS can be read here; anything else is a 404,
 * so the endpoint can't be used to probe the feature_flags table. A missing
 * row reads as disabled (FeatureFlagService fails closed), and clients treat a
 * failed call the same way.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FeatureFlagService } from '@/lib/services/feature-flag-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * Flags the apps may read by name.
 * - ga4_conversions_without_att: iOS sends GA4 conversion events without the
 *   ATT "Allow" requirement (consent rules still apply). Off = ATT required.
 *   Turning it on is a compliance decision: revisit the App Store privacy label first.
 */
const MOBILE_FEATURE_FLAGS = new Set(['ga4_conversions_without_att']);

const NO_STORE = { 'Cache-Control': 'no-store' };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code, message, details: {}, timestamp: new Date().toISOString() },
      meta: null,
    },
    { status, headers: NO_STORE }
  );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const startTime = Date.now();
  const { name } = await params;

  try {
    const user = await requireMobileAuth(request);

    if (!MOBILE_FEATURE_FLAGS.has(name)) {
      return errorResponse(404, 'FLAG_NOT_FOUND', `Unknown feature flag: ${name}`);
    }

    const featureAccess = await FeatureFlagService.isFeatureEnabled(name, user.id, createAdminSupabase(), user);

    return NextResponse.json(
      {
        success: true,
        data: {
          enabled: featureAccess.enabled,
          reason: featureAccess.reason,
          access_level: featureAccess.access_level,
        },
        meta: { requestTime: Date.now() - startTime },
        error: null,
      },
      { headers: NO_STORE }
    );
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return errorResponse(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
    console.error('[Mobile API] Feature flag check error:', { name, message: error?.message });
    return errorResponse(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
  }
}
