import { NextResponse, type NextRequest } from 'next/server';

import { parseClientCards } from '@/lib/home-feed/candidates';
import { readRequestInfo } from '@/lib/home-feed/context';
import { fail, feedFailFrom } from '@/lib/home-feed/http';
import { SUPPORTED_FEED_SCHEMAS } from '@/lib/home-feed/types';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { HomeFeedService } from '@/lib/services/home-feed-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/home-feed?cards=header@1,campaign@1,…  (docs/HOME_FEED_SPEC.md §2)
 *
 * Headers: X-Feed-Schema: 1 (required), X-App-Platform (or X-Platform),
 * X-App-Version, X-App-Build, x-client-timezone.
 * 200 → the schema-1 layout (not the {success,data} envelope — the spec body).
 * 400 → missing/unsupported X-Feed-Schema or empty `cards`. Errors use the
 * standard envelope; clients fall back to their cached/default layout.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);

    const schemaHeader = request.headers.get('x-feed-schema')?.trim();
    if (!schemaHeader) {
      return fail(400, 'FEED_SCHEMA_REQUIRED', 'X-Feed-Schema header is required (supported: 1)', { supported: SUPPORTED_FEED_SCHEMAS });
    }
    if (!(SUPPORTED_FEED_SCHEMAS as readonly number[]).includes(Number(schemaHeader)) || !/^\d+$/.test(schemaHeader)) {
      return fail(400, 'UNSUPPORTED_FEED_SCHEMA', `X-Feed-Schema ${schemaHeader} is not supported (supported: ${SUPPORTED_FEED_SCHEMAS.join(', ')})`, {
        supported: SUPPORTED_FEED_SCHEMAS,
      });
    }

    const support = parseClientCards(request.nextUrl.searchParams.get('cards'));
    if (support.size === 0) {
      return fail(400, 'CARDS_REQUIRED', 'cards query is required: comma-separated type@version the client can render, e.g. cards=header@1,hydration@1');
    }

    const feed = await HomeFeedService.getFeed(user, readRequestInfo(request), support);
    const response = NextResponse.json(feed, { headers: { 'Cache-Control': 'private, no-store' } });
    return await addAutoRefreshHeaders(request, response, user);
  } catch (error) {
    return feedFailFrom(error, 'get');
  }
}
