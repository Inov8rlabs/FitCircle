import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

// Helper to get auth token
async function getAuthToken() {
  const cookieStore = cookies();
  return cookieStore.get('sb-access-token')?.value;
}

// GET /api/challenges/[id] - Get single challenge with full details
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = new DatabaseService();
    const challenge = await db.getChallenge(params.id);

    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge not found' },
        { status: 404 }
      );
    }

    // Get user participation status if authenticated
    const token = await getAuthToken();
    let userParticipation = null;
    let userTeam = null;

    if (token) {
      const { getAuthUser } = await import('@fitcircle/database/client');
      const user = await getAuthUser(token);

      if (user) {
        // Get user's participation
        const { data: participation } = await db.client
          .from('challenge_participants')
          .select('*')
          .eq('challenge_id', params.id)
          .eq('user_id', user.id)
          .single();

        userParticipation = participation;

        // Get user's team if they're in one
        if (participation?.team_id) {
          const { data: team } = await db.client
            .from('teams')
            .select(`
              *,
              members:team_members(
                id, user_id, role,
                user:profiles!user_id(id, username, display_name, avatar_url)
              )
            `)
            .eq('id', participation.team_id)
            .single();

          userTeam = team;
        }
      }
    }

    // Get leaderboard
    const leaderboard = await db.getLeaderboard(params.id, 'individual');

    return NextResponse.json({
      challenge,
      userParticipation,
      userTeam,
      leaderboard: leaderboard.slice(0, 10), // Top 10
    });

  } catch (error) {
    console.error('GET challenge error:', error);

    if (error instanceof DatabaseError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Failed to fetch challenge' },
      { status: 500 }
    );
  }
}

// DELETE /api/challenges/[id] - Delete challenge
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check authentication
    const token = await getAuthToken();
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { getAuthUser } = await import('@fitcircle/database/client');
    const user = await getAuthUser(token);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const db = new DatabaseService();

    // Check if user is the creator
    const challenge = await db.getChallenge(params.id);

    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge not found' },
        { status: 404 }
      );
    }

    if (challenge.creator_id !== user.id) {
      return NextResponse.json(
        { error: 'Only the creator can delete this challenge' },
        { status: 403 }
      );
    }

    // Check if challenge has already started
    if (challenge.status === 'active' || challenge.status === 'completed') {
      return NextResponse.json(
        { error: 'Cannot delete an active or completed challenge' },
        { status: 400 }
      );
    }

    // Delete challenge (cascade will handle related records)
    const { error } = await db.client
      .from('challenges')
      .delete()
      .eq('id', params.id);

    if (error) {
      throw new DatabaseError('Failed to delete challenge', error.code, 500, error);
    }

    return NextResponse.json({
      message: 'Challenge deleted successfully',
    });

  } catch (error) {
    console.error('DELETE challenge error:', error);

    if (error instanceof DatabaseError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Failed to delete challenge' },
      { status: 500 }
    );
  }
}