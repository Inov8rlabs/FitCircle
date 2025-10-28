/**
 * API Route: /api/fitcircles/[id]/submissions/today
 *
 * Get today's submissions for a FitCircle
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { getTodaySubmissions, getSubmissionStats } from '@/lib/services/data-submission-service';

/**
 * GET /api/fitcircles/[id]/submissions/today
 * Query params:
 * - date: string (optional) - Specific date (default: today)
 * - stats: boolean (optional) - Include submission statistics
 *
 * Get who submitted data today
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fitcircleId } = await params;
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const includeStats = searchParams.get('stats') === 'true';

    const supabase = createAdminSupabase();

    // Verify user is a member of the FitCircle
    const { data: membership, error: memberError } = await supabase
      .from('circle_members')
      .select('id')
      .eq('circle_id', fitcircleId)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (memberError || !membership) {
      return NextResponse.json({ error: 'Not a member of this FitCircle' }, { status: 403 });
    }

    // Get submissions
    const { submissions, error } = await getTodaySubmissions(fitcircleId, date, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const response: any = {
      fitcircle_id: fitcircleId,
      date,
      submissions,
    };

    // Include statistics if requested
    if (includeStats) {
      const stats = await getSubmissionStats(fitcircleId, date, supabase);
      if (!stats.error) {
        response.stats = {
          total_members: stats.total_members,
          submitted_count: stats.submitted_count,
          submission_rate: stats.submission_rate,
        };
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Get today submissions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
