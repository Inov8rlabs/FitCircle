import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';

// GET /api/circles/[id]/progress - Get my progress
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get authenticated user
    const supabase = createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get member details
    const members = await CircleService.getCircleMembers(params.id);
    const member = members.find(m => m.user_id === user.id);

    if (!member) {
      return NextResponse.json(
        { error: 'You are not a member of this circle' },
        { status: 403 }
      );
    }

    // Get rank
    const rank = await CircleService.getMyRank(user.id, params.id);

    // Get check-in history (last 30 days)
    const supabaseAdmin = createServerSupabase();
    const { data: checkIns, error: checkInError } = await supabaseAdmin
      .from('circle_check_ins')
      .select('check_in_date, progress_percentage, mood_score, energy_level, note')
      .eq('member_id', member.id)
      .order('check_in_date', { ascending: false })
      .limit(30);

    if (checkInError) throw checkInError;

    return NextResponse.json({
      success: true,
      data: {
        member_id: member.id,
        goal_type: member.goal_type,
        goal_unit: member.goal_unit,
        goal_description: member.goal_description,
        progress_percentage: member.progress_percentage,
        total_check_ins: member.total_check_ins,
        streak_days: member.streak_days,
        longest_streak: member.longest_streak,
        last_check_in_at: member.last_check_in_at,
        rank: rank,
        check_in_history: checkIns || [],
      }
    });
  } catch (error: any) {
    console.error('Get progress error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get progress' },
      { status: 500 }
    );
  }
}