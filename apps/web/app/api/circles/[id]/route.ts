import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';

// GET /api/circles/[id] - Get circle details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get authenticated user (optional - circles can be viewed by non-members with limited info)
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    // Get circle details
    const circle = await CircleService.getCircle(params.id);

    // Check if user is a member
    if (user) {
      const members = await CircleService.getCircleMembers(params.id);
      const isMember = members.some(m => m.user_id === user.id);
      const userMember = members.find(m => m.user_id === user.id);

      return NextResponse.json({
        success: true,
        data: {
          ...circle,
          is_member: isMember,
          user_progress: userMember?.progress_percentage,
          user_rank: isMember ? await CircleService.getMyRank(user.id, params.id) : undefined,
        }
      });
    }

    // Return public info only for non-authenticated users
    return NextResponse.json({
      success: true,
      data: circle
    });
  } catch (error: any) {
    console.error('Get circle error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get circle details' },
      { status: 500 }
    );
  }
}