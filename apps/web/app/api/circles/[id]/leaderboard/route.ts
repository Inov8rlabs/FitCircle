import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';

// GET /api/circles/[id]/leaderboard - Get privacy-safe leaderboard
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get authenticated user (optional - leaderboard can be viewed by non-members with limited info)
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();

    // Check if user is a member (for marking current user in leaderboard)
    let isMember = false;
    if (user) {
      const members = await CircleService.getCircleMembers(params.id);
      isMember = members.some(m => m.user_id === user.id);
    }

    if (!isMember && user) {
      return NextResponse.json(
        { error: 'You must be a member of this circle to view the leaderboard' },
        { status: 403 }
      );
    }

    // Get leaderboard
    const leaderboard = await CircleService.getLeaderboard(params.id);

    // Mark current user if authenticated and member
    const leaderboardWithCurrentUser = leaderboard.map(entry => ({
      ...entry,
      is_current_user: user ? entry.user_id === user.id : false,
    }));

    // Get user's rank if they're a member
    const userRank = user && isMember
      ? await CircleService.getMyRank(user.id, params.id)
      : undefined;

    // Get circle stats
    const stats = await CircleService.getCircleStats(params.id);

    return NextResponse.json({
      success: true,
      data: {
        leaderboard: leaderboardWithCurrentUser,
        user_rank: userRank,
        circle_stats: stats,
        last_updated: new Date().toISOString(),
      }
    });
  } catch (error: any) {
    console.error('Get leaderboard error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get leaderboard' },
      { status: 500 }
    );
  }
}