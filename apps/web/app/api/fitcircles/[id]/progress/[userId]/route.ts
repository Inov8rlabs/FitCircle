import { type NextRequest, NextResponse } from 'next/server';

import { CircleNotFoundError, MemberProgressService } from '@/lib/services/member-progress-service';
import { createServerSupabase } from '@/lib/supabase-server';

/**
 * GET /api/fitcircles/[id]/progress/[userId] — the web circle's participant sheet.
 *
 * `progress` is the member's progress in the circle's own metric (steps,
 * weight, workout minutes, a custom challenge unit) with privacy applied:
 * docs/MEMBER_PROGRESS_CONTRACT.md. `entries` keeps the old shape for the
 * owner's weight-entry editor and only ever holds WEIGHTS (kg): it used to hold
 * a steps circle's step totals, which the sheet rendered as kilograms, and it
 * ignored "Show weight" / "Show progress".
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const { id: circleId, userId } = await context.params;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const progress = await MemberProgressService.getMemberCircleProgress(
      userId.toLowerCase(),
      user.id,
      circleId.toLowerCase()
    );

    const entries =
      progress.metric === 'weight' && progress.can_view
        ? progress.entries.map((e) => ({ tracking_date: e.date, value: e.value, is_public: e.is_public }))
        : [];

    return NextResponse.json(
      { entries, total: entries.length, progress },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof CircleNotFoundError) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }
    if (error instanceof Error && error.message === 'User not found') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    console.error('Error in progress API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
