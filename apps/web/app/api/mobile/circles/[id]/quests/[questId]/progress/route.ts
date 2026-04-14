import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleQuestService } from '@/lib/services/circle-quest-service';

const progressSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0'),
});

/**
 * POST /api/mobile/circles/[id]/quests/[questId]/progress
 * Update user's progress on a quest
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; questId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { questId } = await params;
    const body = await request.json();

    const validated = progressSchema.parse(body);

    const result = await CircleQuestService.updateProgress(
      questId,
      user.id,
      validated.amount
    );

    return NextResponse.json({
      success: true,
      data: result,
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
    return NextResponse.json(
      { success: false, data: null, error: { code: 'ERROR', message: error.message } },
      { status: 400 }
    );
  }
}
