import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { GoalRecommendationService } from '@/lib/services/goal-recommendations';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/daily-goals/recommendations
 * Get personalized daily goal recommendations
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    console.log(`[Mobile Daily Goals Recommendations] Fetching recommendations for user: ${user.id}`);

    // Get recommendations
    const recommendations = await GoalRecommendationService.getRecommendations(
      user.id,
      supabaseAdmin
    );

    console.log(`[Mobile Daily Goals Recommendations] Found ${recommendations?.length || 0} recommendations`);

    const response = NextResponse.json({
      success: true,
      data: { recommendations: recommendations || [] },
      error: null,
      meta: {
        requestTime: Date.now(),
      },
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('[Mobile Daily Goals Recommendations] Error:', error);

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
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
