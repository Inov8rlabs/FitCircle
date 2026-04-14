import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleQuestService } from '@/lib/services/circle-quest-service';

/**
 * GET /api/mobile/circles/[id]/quests/[questId]
 * Get quest detail with leaderboard
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; questId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { questId } = await params;

    const result = await CircleQuestService.getQuestDetail(questId, user.id);

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
