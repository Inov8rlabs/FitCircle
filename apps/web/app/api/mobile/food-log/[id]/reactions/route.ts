import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleFoodFeedService } from '@/lib/services/circle-food-feed-service';
import { REACTION_KINDS, type ReactionKind } from '@/lib/types/food-feed';

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

export function mapReactionError(error: any, label: string) {
  console.error(`[Mobile API] ${label} error:`, {
    message: error?.message,
    stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
  });

  if (error?.message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
    );
  }
  if (error?.message === 'Forbidden') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'FORBIDDEN', message: 'You cannot react to this entry', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 403 }
    );
  }
  if (error?.message === 'NotFound') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Food log entry not found', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 404 }
    );
  }
  if (error?.message === 'BadRequest' || error instanceof z.ZodError) {
    const details =
      error instanceof z.ZodError
        ? error.errors.reduce((acc: any, err) => {
            acc[err.path.join('.')] = err.message;
            return acc;
          }, {})
        : { reaction: `Expected one of: ${REACTION_KINDS.join(', ')}` };
    return NextResponse.json(
      { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details, timestamp: new Date().toISOString() }, meta: null },
      { status: 400 }
    );
  }
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}
