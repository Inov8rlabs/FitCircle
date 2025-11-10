/**
 * Food Logging Feature Flag API Route
 * GET /api/mobile/food-log/feature-flag - Check if feature is enabled for user
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FeatureFlagService } from '@/lib/services/feature-flag-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/food-log/feature-flag
 * Check if food logging feature is enabled for the current user
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);
    const supabase = createAdminSupabase();

    // Check feature flag
    const featureAccess = await FeatureFlagService.isFeatureEnabled('food_logging', user.id, supabase);

    return NextResponse.json({
      success: true,
      data: {
        enabled: featureAccess.enabled,
        reason: featureAccess.reason,
        access_level: featureAccess.access_level,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Check food log feature flag error:', {
      userId: error.userId,
      message: error.message,
    });

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
