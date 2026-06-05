import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleFoodFeedService } from '@/lib/services/circle-food-feed-service';
import { REACTION_KINDS, type ReactionKind } from '@/lib/types/food-feed';

import { mapReactionError } from './reaction-errors';

// Six-emoji tapback — SAME set as circle chat (REACTION_KINDS reused).
const addReactionSchema = z.object({
  reaction: z.enum(REACTION_KINDS as [string, ...string[]]),
});

/**
 * POST /api/mobile/food-log/[id]/reactions  { reaction }
 * PRD v4 §6.3 — add a six-emoji reaction to a food log entry surfaced in the feed.
 * Authorized iff the reactor shares an active circle with the entry owner.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;

    const body = await request.json();
    const { reaction } = addReactionSchema.parse(body);

    // zod validated `reaction` at runtime; narrow the widened string back to ReactionKind.
    const reactions = await CircleFoodFeedService.addReaction(
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
    return mapReactionError(error, 'Add food-log reaction');
  }
}
