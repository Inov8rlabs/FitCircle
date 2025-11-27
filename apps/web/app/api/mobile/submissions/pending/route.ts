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
 * Response:
 * {
 *   success: true,
 *   data: {
 *     date: string,
 *     pending_submissions: PendingSubmission[],
 *     count: number,
 *     hasPendingSubmissions: boolean
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

    const count = pending.filter(p => p.can_submit).length;
    const has_pending_submissions = count > 0;

    console.log(`[Mobile Pending Submissions] Found ${count} pending submissions (${pending.length} total circles)`);

    const response = NextResponse.json({
      success: true,
      data: {
        date,
        pending_submissions: pending,
        count,
        has_pending_submissions,
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
