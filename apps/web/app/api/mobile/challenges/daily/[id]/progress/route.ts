import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DailyChallengeService } from '@/lib/services/daily-challenge-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

const progressBodySchema = z.object({
  progress: z.number().min(0),
});

const idSchema = z.string().uuid();

/**
 * GET /api/mobile/challenges/daily/[id]/progress
 * Read the authenticated user's progress on the given daily challenge.
 *
 * Response data:
 * {
 *   challenge_id: string,
 *   user_progress: number,
 *   is_completed: boolean,
 *   rank: number
 * }
 *
 * If the user is not yet a participant, returns progress=0, is_completed=false,
 * rank=0 (rather than 404) so the client can render a default state.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const challengeId = idSchema.parse(id);

    const supabaseAdmin = createAdminSupabase();

    // Fetch the user's participant row (if any) and the count of participants
    // whose progress is strictly higher — `count + 1` is the user's rank.
    const [{ data: participant }, { count: ahead }] = await Promise.all([
      supabaseAdmin
        .from('daily_challenge_participants')
        .select('progress, is_completed')
        .eq('challenge_id', challengeId)
        .eq('user_id', user.id)
        .maybeSingle(),
      supabaseAdmin
        .from('daily_challenge_participants')
        .select('user_id', { count: 'exact', head: true })
        .eq('challenge_id', challengeId)
        .gt('progress', 0), // placeholder; refined below once we know user's progress
    ]);

    const userProgress = participant?.progress ?? 0;
    const isCompleted = participant?.is_completed ?? false;

    // Compute rank only if the user has any progress; otherwise default to 0.
    let rank = 0;
    if (participant) {
      const { count: aheadOfUser } = await supabaseAdmin
        .from('daily_challenge_participants')
        .select('user_id', { count: 'exact', head: true })
        .eq('challenge_id', challengeId)
        .gt('progress', userProgress);
      rank = (aheadOfUser ?? 0) + 1;
    }

    return NextResponse.json({
      success: true,
      data: {
        challenge_id: challengeId,
        user_progress: userProgress,
        is_completed: isCompleted,
        rank,
      },
      error: null,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid challenge id', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('[GET /api/mobile/challenges/daily/[id]/progress] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/challenges/daily/[id]/progress
 * Update the authenticated user's progress on the given daily challenge.
 *
 * Body: { progress: number }
 * Response shape matches GET above.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const challengeId = idSchema.parse(id);

    const body = await request.json();
    const { progress } = progressBodySchema.parse(body);

    const result = await DailyChallengeService.updateProgress(user.id, challengeId, progress);

    return NextResponse.json({
      success: true,
      data: result,
      error: null,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.errors } },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message === 'Not a participant') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'NOT_PARTICIPANT', message: 'Join the challenge first' } },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message === 'Challenge not found') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Challenge not found' } },
        { status: 404 }
      );
    }

    console.error('[POST /api/mobile/challenges/daily/[id]/progress] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
