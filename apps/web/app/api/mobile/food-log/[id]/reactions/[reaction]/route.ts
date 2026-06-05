import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleFoodFeedService } from '@/lib/services/circle-food-feed-service';
import { REACTION_KINDS, type ReactionKind } from '@/lib/types/food-feed';

import { mapReactionError } from '../reaction-errors';

/**
 * DELETE /api/mobile/food-log/[id]/reactions/[reaction]
 * PRD v4 §6.3 — remove the caller's six-emoji reaction from a food log entry.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reaction: string }> }
) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id, reaction } = await params;

    if (!REACTION_KINDS.includes(reaction as ReactionKind)) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: { reaction: `Invalid reaction kind. Expected one of: ${REACTION_KINDS.join(', ')}` },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    const reactions = await CircleFoodFeedService.removeReaction(
      id,
      user.id,
      reaction as ReactionKind
    );

    return NextResponse.json({
      success: true,
      data: { reactions },
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    return mapReactionError(error, 'Remove food-log reaction');
  }
}
