/**
 * API Route: /api/user/submissions/pending
 *
 * Get pending submissions for current user
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { getPendingSubmissions } from '@/lib/services/data-submission-service';

/**
 * GET /api/user/submissions/pending
 * Query params:
 * - date: string (optional) - Specific date (default: today)
 *
 * Check pending submissions for the user
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    const supabase = createAdminSupabase();

    const { pending, error } = await getPendingSubmissions(user.id, date, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      date,
      pending_submissions: pending,
      count: pending.filter(p => p.can_submit).length,
    });
  } catch (error) {
    console.error('Get pending submissions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
