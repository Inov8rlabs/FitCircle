import { type NextRequest, NextResponse } from 'next/server';

import { CircleStepsLeaderboardService } from '@/lib/services/circle-steps-leaderboard-service';
import { resolveClientTimezone } from '@/lib/streaks/client-timezone';
import { createServerSupabase } from '@/lib/supabase-server';
import { isUuid, normalizeId } from '@/lib/validation/circle-validation';

/**
 * GET /api/fitcircles/[id]/steps-leaderboard — the web (cookie session) twin of
 * /api/mobile/circles/[id]/steps-leaderboard. Same body as the mobile `data`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id: rawId } = await params;
    if (!isUuid(rawId)) return NextResponse.json({ error: 'Invalid circle ID' }, { status: 400 });

    const result = await CircleStepsLeaderboardService.build(normalizeId(rawId), user.id, resolveClientTimezone(request));
    if (!result.ok) {
      return NextResponse.json(
        { error: result.code },
        { status: result.code === 'CIRCLE_NOT_FOUND' ? 404 : 403 }
      );
    }
    return NextResponse.json(result.board, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error: any) {
    console.error('[StepsLeaderboard web] Error:', error?.message ?? error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
