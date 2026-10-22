import { NextResponse, type NextRequest } from 'next/server';

import { fail, feedFailFrom, readJson } from '@/lib/home-feed/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { HomeFeedService, MAX_EVENTS_PER_BATCH, feedEventsBodySchema } from '@/lib/services/home-feed-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/home-feed/events  (docs/HOME_FEED_SPEC.md §5)
 * Body: { decision_id, events: [{ card_id, card_type, position, event, at }] } (1–50).
 * 204 on accept — the insert runs after the response (fire-and-forget).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const parsed = feedEventsBodySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return fail(400, 'VALIDATION_ERROR', `Invalid events body (max ${MAX_EVENTS_PER_BATCH} events per batch)`, { issues });
    }
    HomeFeedService.recordEvents(user.id, parsed.data);
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return feedFailFrom(error, 'events');
  }
}
