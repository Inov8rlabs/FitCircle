import { type NextRequest, NextResponse } from 'next/server';

import { CircleService } from '@/lib/services/circle-service';
import { createServerSupabase } from '@/lib/supabase-server';

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

    // `success` + `data` is the envelope the iOS app decodes (Manage circle →
    // Participants); `leaderboard` stays for the web circle page.
    return NextResponse.json({
      success: true,
      data: leaderboardWithCurrentUser.map(entry => ({
        ...entry,
        // iOS decodes ISO8601 with milliseconds (as the mobile leaderboard sends)
        last_check_in_at: entry.last_check_in_at ? new Date(entry.last_check_in_at).toISOString() : null,
      })),
      leaderboard: leaderboardWithCurrentUser,
      total_participants: leaderboard.length
    });

  } catch (error) {
    console.error('Error in leaderboard API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
