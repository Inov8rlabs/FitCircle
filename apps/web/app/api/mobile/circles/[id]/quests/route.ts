import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleQuestService, type CreateQuestInput } from '@/lib/services/circle-quest-service';

const createQuestSchema = z.object({
  quest_name: z.string().min(3).max(100),
  quest_description: z.string().max(500).optional(),
  quest_type: z.enum(['individual', 'collaborative', 'competitive']),
  goal_amount: z.number().positive(),
  unit: z.string().min(1).max(20),
  collective_target: z.number().positive().optional(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  template_id: z.string().uuid().optional(),
  challenge_id: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * GET /api/mobile/circles/[id]/quests
 * List active quests for a circle
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;

    const quests = await CircleQuestService.getActiveQuests(circleId, user.id);

    return NextResponse.json({
      success: true,
      data: quests,
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
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

/**
 * POST /api/mobile/circles/[id]/quests
 * Create a new quest in a circle
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;
    const body = await request.json();

    const validated = createQuestSchema.parse(body);

    const quest = await CircleQuestService.createQuest(
      circleId,
      user.id,
      validated as CreateQuestInput
    );

    return NextResponse.json({
      success: true,
      data: quest,
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
