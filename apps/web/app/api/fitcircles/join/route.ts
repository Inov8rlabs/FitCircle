import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { z } from 'zod';

// Validation schema for joining a FitCircle
const joinFitCircleSchema = z.object({
  fitCircleId: z.string().uuid().optional(),
  inviteCode: z.string().optional(),
}).refine(data => data.fitCircleId || data.inviteCode, {
  message: 'Either fitCircleId or inviteCode must be provided',
});

/**
 * POST /api/fitcircles/join
 * Join an existing FitCircle (Sarah persona flow)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const body = await request.json();
    const validatedData = joinFitCircleSchema.parse(body);

    console.log('[FitCircles API] User joining FitCircle:', user.id);

    const supabaseAdmin = createAdminSupabase();

    let challengeId = validatedData.fitCircleId;

    // If invite code provided, look up challenge
    if (validatedData.inviteCode && !challengeId) {
      const { data: team, error: teamError } = await supabaseAdmin
        .from('teams')
        .select('challenge_id')
        .eq('invite_code', validatedData.inviteCode)
        .single();

      if (teamError || !team) {
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: 'INVALID_INVITE_CODE',
              message: 'Invalid invite code',
              details: {},
              timestamp: new Date().toISOString(),
            },
            meta: null,
          },
          { status: 404 }
        );
      }

      challengeId = team.challenge_id;
    }

    if (!challengeId) {
      throw new Error('Challenge ID is required');
    }

    // Get challenge details
    const { data: challenge, error: challengeError } = await supabaseAdmin
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .single();

    if (challengeError || !challenge) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'CHALLENGE_NOT_FOUND',
            message: 'FitCircle not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    // Check if already a participant
    const { data: existingParticipant } = await supabaseAdmin
      .from('challenge_participants')
      .select('id')
      .eq('challenge_id', challengeId)
      .eq('user_id', user.id)
      .single();

    if (existingParticipant) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'ALREADY_JOINED',
            message: 'You are already a member of this FitCircle',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 409 }
      );
    }

    // Check if max participants reached
    if (challenge.max_participants) {
      const { count } = await supabaseAdmin
        .from('challenge_participants')
        .select('id', { count: 'exact', head: true })
        .eq('challenge_id', challengeId)
        .eq('status', 'active');

      if (count && count >= challenge.max_participants) {
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: 'MAX_PARTICIPANTS_REACHED',
              message: 'This FitCircle has reached maximum participants',
              details: {},
              timestamp: new Date().toISOString(),
            },
            meta: null,
          },
          { status: 409 }
        );
      }
    }

    // Add user as participant
    const { data: participant, error: participantError } = await supabaseAdmin
      .from('challenge_participants')
      .insert({
        challenge_id: challengeId,
        user_id: user.id,
        status: 'active',
        joined_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (participantError) {
      console.error('[FitCircles API] Error adding participant:', participantError);
      throw participantError;
    }

    console.log('[FitCircles API] User joined FitCircle successfully');

    return NextResponse.json({
      success: true,
      data: {
        fitCircle: {
          id: challenge.id,
          name: challenge.name,
          description: challenge.description,
          type: challenge.type,
          status: challenge.status,
          startDate: challenge.start_date,
          endDate: challenge.end_date,
        },
        participation: {
          id: participant.id,
          joinedAt: participant.joined_at,
          status: participant.status,
        },
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[FitCircles API] Join FitCircle error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid join request',
            details: error.errors.reduce((acc: any, err) => {
              acc[err.path.join('.')] = err.message;
              return acc;
            }, {}),
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to join FitCircle',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
