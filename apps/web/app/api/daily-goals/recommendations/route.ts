/**
 * Daily Goal Recommendations API
 *
 * GET /api/daily-goals/recommendations
 *
 * Returns intelligent goal recommendations based on:
 * - User's active FitCircle challenges
 * - Challenge types and goals
 * - General health recommendations (if no challenges)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { GoalRecommendationService } from '@/lib/services/goal-recommendations';

/**
 * GET /api/daily-goals/recommendations
 * Fetch personalized goal recommendations for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get recommendations from service
    const recommendations = await GoalRecommendationService.getRecommendations(
      user.id,
      supabase
    );

    return NextResponse.json({
      success: true,
      recommendations,
    });
  } catch (error) {
    console.error('Error getting goal recommendations:', error);
    return NextResponse.json(
      {
        error: 'Failed to get recommendations',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
