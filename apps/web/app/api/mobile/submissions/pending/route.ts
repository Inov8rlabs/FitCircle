/**
 * API Route: /api/mobile/submissions/pending
 *
 * Get pending submissions for current user (Mobile version)
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { getPendingSubmissions } from '@/lib/services/data-submission-service';

/**
 * GET /api/mobile/submissions/pending
 * Query params:
 * - date: string (optional) - Specific date (default: today)
 *
 * Check pending submissions for the user
 *
 * Response (iOS format):
 * {
 *   success: true,
 *   data: {
 *     has_pending_submissions: boolean,
 *     today_steps: number,
 *     today_weight: number | null,
 *     circles: [{ circle_id, circle_name, has_submitted_today }]
 *   },
 *   error: null,
 *   meta: { requestTime: number }
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    console.log(`[Mobile Pending Submissions] Checking for user: ${user.id}, date: ${date}`);

    const supabase = createAdminSupabase();

    // Fetch today's tracking data for steps and weight
    const { data: todayTracking } = await supabase
      .from('daily_tracking')
      .select('steps, weight_kg')
      .eq('user_id', user.id)
      .eq('tracking_date', date)
      .single();

    const today_steps = todayTracking?.steps || 0;
    const today_weight = todayTracking?.weight_kg || null;

    const { pending, error } = await getPendingSubmissions(user.id, date, supabase);

    if (error) {
      console.error('[Mobile Pending Submissions] Error:', error);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FETCH_ERROR',
            message: error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 500 }
      );
    }

    // Transform to iOS expected format
    const circles = pending.map(p => ({
      circle_id: p.fitcircle_id,
      circle_name: p.fitcircle_name,
      has_submitted_today: p.already_submitted,
    }));

    const has_pending_submissions = pending.some(p => p.can_submit);

    console.log(`[Mobile Pending Submissions] Found ${circles.length} circles, has_pending: ${has_pending_submissions}, steps: ${today_steps}`);

    const response = NextResponse.json({
      success: true,
      data: {
        has_pending_submissions,
        today_steps,
        today_weight,
        circles,
      },
      error: null,
      meta: {
        requestTime: Date.now(),
      },
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('[Mobile Pending Submissions] Error:', error);

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
