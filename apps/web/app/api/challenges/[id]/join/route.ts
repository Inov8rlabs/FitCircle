import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { z } from 'zod';

const joinChallengeSchema = z.object({
  team_id: z.string().uuid().optional(),
  starting_weight_kg: z.number().positive().optional(),
  goal_weight_kg: z.number().positive().optional(),
  starting_value: z.number().optional(),
  goal_value: z.number().optional(),
});

// POST /api/challenges/[id]/join - Join a challenge
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check authentication
    const cookieStore = cookies();
    const token = cookieStore.get('sb-access-token')?.value;

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

    // Parse request body
    const body = await request.json();
    const validatedData = joinChallengeSchema.parse(body);

    const db = new DatabaseService();

    // Get challenge details
    const challenge = await db.getChallenge(params.id);

    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge not found' },
        { status: 404 }
      );
    }

    // Check if challenge is joinable
    if (challenge.status !== 'upcoming' && challenge.status !== 'active') {
      return NextResponse.json(
        { error: 'Challenge is not open for registration' },
        { status: 400 }
      );
    }

    // Check registration deadline
    const now = new Date();
    const deadline = new Date(challenge.registration_deadline);

    if (now > deadline && !challenge.allow_late_join) {
      return NextResponse.json(
        { error: 'Registration deadline has passed' },
        { status: 400 }
      );
    }

    // Check if user is already participating
    const { data: existingParticipation } = await db.client
      .from('challenge_participants')
      .select('id')
      .eq('challenge_id', params.id)
      .eq('user_id', user.id)
      .single();

    if (existingParticipation) {
      return NextResponse.json(
        { error: 'You are already participating in this challenge' },
        { status: 400 }
      );
    }

    // Check max participants limit
    if (challenge.max_participants && challenge.participant_count >= challenge.max_participants) {
      return NextResponse.json(
        { error: 'Challenge has reached maximum participants' },
        { status: 400 }
      );
    }

    // If team_id is provided, verify team exists and user can join
    if (validatedData.team_id) {
      const { data: team } = await db.client
        .from('teams')
        .select('*')
        .eq('id', validatedData.team_id)
        .eq('challenge_id', params.id)
        .single();

      if (!team) {
        return NextResponse.json(
          { error: 'Team not found or does not belong to this challenge' },
          { status: 400 }
        );
      }

      if (team.member_count >= team.max_members) {
        return NextResponse.json(
          { error: 'Team is full' },
          { status: 400 }
        );
      }

      // Join team as well
      await db.joinTeam(validatedData.team_id, user.id);
    }

    // Join challenge
    const participation = await db.joinChallenge(params.id, user.id, validatedData.team_id);

    // Update participant count using service
    await ChallengeService.updateParticipantCount(params.id, true);

    // Update team member count if joining a team
    if (validatedData.team_id) {
      await ChallengeService.updateTeamMemberCount(validatedData.team_id, true);
    }

    // Update participant with initial values if provided
    if (validatedData.starting_weight_kg || validatedData.goal_weight_kg ||
        validatedData.starting_value || validatedData.goal_value) {
      await db.client
        .from('challenge_participants')
        .update({
          starting_weight_kg: validatedData.starting_weight_kg,
          goal_weight_kg: validatedData.goal_weight_kg,
          starting_value: validatedData.starting_value,
          goal_value: validatedData.goal_value,
          updated_at: new Date().toISOString(),
        })
        .eq('id', participation.id);
    }

    // Create notification
    await db.createNotification({
      user_id: user.id,
      type: 'challenge_invite',
      channel: 'in_app',
      title: 'Successfully joined challenge!',
      body: `You are now participating in "${challenge.name}". Good luck!`,
      related_challenge_id: params.id,
      action_url: `/challenges/${params.id}`,
    });

    // Process payment if there's an entry fee
    if (challenge.entry_fee && challenge.entry_fee > 0) {
      // In a real implementation, you'd integrate with Stripe here
      // For now, we'll create a pending payment record
      await db.client
        .from('payments')
        .insert({
          user_id: user.id,
          challenge_id: params.id,
          amount: challenge.entry_fee,
          status: 'pending',
          type: 'entry_fee',
          description: `Entry fee for ${challenge.name}`,
        });
    }

    return NextResponse.json({
      participation,
      message: 'Successfully joined the challenge!',
    });

  } catch (error) {
    console.error('Join challenge error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    if (error instanceof DatabaseError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Failed to join challenge' },
      { status: 500 }
    );
  }
}

// DELETE /api/challenges/[id]/join - Leave a challenge
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Check authentication
    const cookieStore = cookies();
    const token = cookieStore.get('sb-access-token')?.value;

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

    // Get participation record
    const { data: participation } = await db.client
      .from('challenge_participants')
      .select('*')
      .eq('challenge_id', params.id)
      .eq('user_id', user.id)
      .single();

    if (!participation) {
      return NextResponse.json(
        { error: 'You are not participating in this challenge' },
        { status: 400 }
      );
    }

    // Get challenge details
    const challenge = await db.getChallenge(params.id);

    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge not found' },
        { status: 404 }
      );
    }

    // Check if challenge has already started (can't leave active challenges)
    if (challenge.status === 'active') {
      // Mark as dropped instead of deleting
      await db.client
        .from('challenge_participants')
        .update({
          status: 'dropped',
          dropped_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', participation.id);

      return NextResponse.json({
        message: 'You have dropped out of the challenge',
      });
    }

    // If challenge hasn't started, fully remove participation
    // First, leave team if in one
    if (participation.team_id) {
      await db.client
        .from('team_members')
        .delete()
        .eq('team_id', participation.team_id)
        .eq('user_id', user.id);

      // Update team member count using service
      await ChallengeService.updateTeamMemberCount(participation.team_id, false);
    }

    // Delete participation record
    await db.client
      .from('challenge_participants')
      .delete()
      .eq('id', participation.id);

    // Update participant count using service
    await ChallengeService.updateParticipantCount(params.id, false);

    // Process refund if applicable
    if (challenge.entry_fee && challenge.entry_fee > 0 && challenge.status === 'upcoming') {
      // In a real implementation, you'd process refund via Stripe
      const { data: payment } = await db.client
        .from('payments')
        .select('*')
        .eq('user_id', user.id)
        .eq('challenge_id', params.id)
        .eq('type', 'entry_fee')
        .eq('status', 'succeeded')
        .single();

      if (payment) {
        await db.client
          .from('payments')
          .insert({
            user_id: user.id,
            challenge_id: params.id,
            amount: payment.amount,
            status: 'pending',
            type: 'refund',
            description: `Refund for ${challenge.name}`,
          });
      }
    }

    return NextResponse.json({
      message: 'Successfully left the challenge',
    });

  } catch (error) {
    console.error('Leave challenge error:', error);

    if (error instanceof DatabaseError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: 'Failed to leave challenge' },
      { status: 500 }
    );
  }
}