/**
 * API Route: /api/fitcircles/[id]/submit
 *
 * Submit data to a FitCircle
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { submitToFitCircle } from '@/lib/services/data-submission-service';

/**
 * POST /api/fitcircles/[id]/submit
 * Body: { date?: string }
 *
 * Submit today's tracking data to the FitCircle
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fitcircleId } = await params;
    const body = await request.json().catch(() => ({}));
    const date = body.date || new Date().toISOString().split('T')[0];

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

    // Submit data
    const { submission, error } = await submitToFitCircle(user.id, fitcircleId, date, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      submission,
      message: 'Data submitted successfully',
    });
  } catch (error) {
    console.error('Submit to FitCircle error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
