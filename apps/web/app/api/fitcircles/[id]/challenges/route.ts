import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ChallengeService } from '@/lib/services/circle-challenge-service';
import { z } from 'zod';

const createChallengeSchema = z.object({
  template_id: z.string().optional(),
  name: z.string().min(3).max(50),
  description: z.string().max(200).optional(),
  category: z.enum(['strength', 'cardio', 'flexibility', 'wellness', 'custom']),
  goal_amount: z.number().positive(),
  unit: z.string().min(1).max(20),
  logging_prompt: z.string().max(60).optional(),
  is_open: z.boolean().optional(),
  starts_at: z.string(),
  ends_at: z.string(),
  invite_user_ids: z.array(z.string().uuid()).optional(),
});

/**
 * GET /api/fitcircles/[id]/challenges
 * List all challenges for a circle
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;

    const challenges = await ChallengeService.getCircleChallenges(circleId, user.id);

    return NextResponse.json({
      success: true,
      data: challenges,
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { success: false, data: null, error: { code: 'ERROR', message: error.message } },
      { status: 400 }
    );
  }
}

/**
 * POST /api/fitcircles/[id]/challenges
 * Create a new challenge within a circle
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;
    const body = await request.json();
    const validated = createChallengeSchema.parse(body);

    const challenge = await ChallengeService.createChallenge(user.id, {
      ...validated,
      circle_id: circleId,
    });

    return NextResponse.json({
      success: true,
      data: challenge,
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid data', details: error.errors } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, data: null, error: { code: 'ERROR', message: error.message } },
      { status: 400 }
    );
  }
}
