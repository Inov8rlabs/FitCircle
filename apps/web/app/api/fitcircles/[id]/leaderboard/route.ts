import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { LeaderboardService } from '@/lib/services/leaderboard-service';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createServerSupabase();
    const challengeId = params.id;

    // Get authenticated user (optional - leaderboard can be viewed by anyone in the challenge)
    const { data: { user } } = await supabase.auth.getUser();

    console.log('Fetching leaderboard for challenge:', challengeId);

    // Get leaderboard data from daily_tracking
    const leaderboard = await LeaderboardService.getLeaderboard(challengeId, supabase);

    console.log('Leaderboard entries:', leaderboard.length);

    // Mark the current user
    const leaderboardWithCurrentUser = leaderboard.map(entry => ({
      ...entry,
      is_current_user: entry.user_id === user?.id,
    }));

    return NextResponse.json({
      leaderboard: leaderboardWithCurrentUser,
      total_participants: leaderboard.length
    });

  } catch (error) {
    console.error('Error in leaderboard API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
