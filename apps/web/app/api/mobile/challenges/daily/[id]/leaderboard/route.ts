import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DailyChallengeService } from '@/lib/services/daily-challenge-service';

const idSchema = z.string().uuid();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** `?limit=` as a whole number in 1..100; anything unreadable falls back to 20. */
function parseLimit(raw: string | null): number {
  const parsed = raw === null ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * GET /api/mobile/challenges/daily/[id]/leaderboard?limit=20
 * Top participants for a daily challenge, ordered by progress desc.
 *
 * `data` is the list of rows, each with its `rank`. Next to `data` the
 * response also carries the requesting user's own position, which is needed
 * when they are outside the top `limit`:
 *   user_entry          the user's row (same shape as a list row) or null
 *   user_rank           the user's rank or null (not joined)
 *   total_participants  number of users who joined
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const challengeId = idSchema.parse(id);

    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams.get('limit'));

    const leaderboard = await DailyChallengeService.getLeaderboardWithViewer(
      challengeId,
      limit,
      user.id
    );

    const response = NextResponse.json({
      success: true,
      data: leaderboard.entries,
      error: null,
      user_entry: leaderboard.user_entry,
      user_rank: leaderboard.user_rank,
      total_participants: leaderboard.total_participants,
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
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

    console.error('[GET /api/mobile/challenges/daily/[id]/leaderboard] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
