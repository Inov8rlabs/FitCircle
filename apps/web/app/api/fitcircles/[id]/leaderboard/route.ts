import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { CircleService } from '@/lib/services/circle-service';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const { id: challengeId } = await context.params;

    // Get authenticated user (optional - leaderboard can be viewed by anyone in the challenge)
    const { data: { user } } = await supabase.auth.getUser();

    console.log('Fetching leaderboard for challenge:', challengeId);

    // Get leaderboard data directly from challenge_participants (same as mobile API)
    const leaderboard = await CircleService.getLeaderboard(challengeId);

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
