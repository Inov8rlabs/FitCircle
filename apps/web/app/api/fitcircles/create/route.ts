import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { z } from 'zod';

// Validation schema for creating a FitCircle
const createFitCircleSchema = z.object({
  name: z.string().min(3).max(50),
  description: z.string().max(500).optional(),
  type: z.enum(['weight_loss', 'step_count', 'workout_minutes', 'custom']),
  startDate: z.string(), // ISO date string
  endDate: z.string(), // ISO date string
  visibility: z.enum(['public', 'private', 'invite_only']).default('invite_only'),
  entryFee: z.number().min(0).default(0),
  maxParticipants: z.number().int().positive().optional(),
  rules: z.record(z.any()).optional(),
});

/**
 * POST /api/fitcircles/create
 * Create a new FitCircle during onboarding (Sarah persona flow)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const body = await request.json();
    const validatedData = createFitCircleSchema.parse(body);

    console.log('[FitCircles API] Creating FitCircle for user:', user.id);

    const supabaseAdmin = createAdminSupabase();

    // Create challenge (FitCircle)
    const { data: challenge, error: challengeError } = await supabaseAdmin
      .from('challenges')
      .insert({
        creator_id: user.id,
        name: validatedData.name,
        description: validatedData.description || null,
        type: validatedData.type,
        status: 'upcoming',
        visibility: validatedData.visibility,
        start_date: validatedData.startDate,
        end_date: validatedData.endDate,
        registration_deadline: validatedData.startDate,
        entry_fee: validatedData.entryFee,
        max_participants: validatedData.maxParticipants || null,
        min_participants: 2,
        rules: validatedData.rules || {},
        scoring_system: { type: 'progress_percentage' },
      })
      .select()
      .single();

    if (challengeError) {
      console.error('[FitCircles API] Error creating challenge:', challengeError);
      throw challengeError;
    }

    // Automatically add creator as first participant
    const { error: participantError } = await supabaseAdmin
      .from('challenge_participants')
      .insert({
        challenge_id: challenge.id,
        user_id: user.id,
        status: 'active',
        joined_at: new Date().toISOString(),
      });

    if (participantError) {
      console.error('[FitCircles API] Error adding creator as participant:', participantError);
    }

    console.log('[FitCircles API] FitCircle created successfully:', challenge.id);

    return NextResponse.json({
      success: true,
      data: {
        fitCircle: {
          id: challenge.id,
          name: challenge.name,
          description: challenge.description,
          type: challenge.type,
          status: challenge.status,
          visibility: challenge.visibility,
          startDate: challenge.start_date,
          endDate: challenge.end_date,
          participantCount: 1,
          creatorId: challenge.creator_id,
        },
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[FitCircles API] Create FitCircle error:', error);

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
            message: 'Invalid FitCircle data',
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
          message: 'Failed to create FitCircle',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
