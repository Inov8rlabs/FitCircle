import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CustomChallengeService, type CustomChallengeInput } from '@/lib/services/custom-challenge-service';

const customChallengeSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  category: z.enum(['strength', 'cardio', 'flexibility', 'wellness', 'mixed']),
  goal_amount: z.number().positive(),
  unit: z.string().min(1).max(20),
  duration_days: z.number().int().min(1).max(365),
  fitcircle_id: z.string().uuid().optional(),
  quest_type: z.enum(['individual', 'collaborative', 'competitive']).optional(),
});

/**
 * POST /api/mobile/challenges/custom
 * Create a fully custom challenge
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();

    const validated = customChallengeSchema.parse(body);

    const challenge = await CustomChallengeService.createCustomChallenge(
      user.id,
      validated as CustomChallengeInput
    );

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
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors } },
        { status: 400 }
      );
    }
    if (error.message?.includes('active member')) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'FORBIDDEN', message: error.message } },
        { status: 403 }
      );
    }
    if (error.message?.startsWith('Validation failed:')) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: error.message } },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, data: null, error: { code: 'ERROR', message: error.message } },
      { status: 400 }
    );
  }
}
