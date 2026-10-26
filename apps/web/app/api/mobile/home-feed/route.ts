import { NextResponse, type NextRequest } from 'next/server';

import { parseClientCards } from '@/lib/home-feed/candidates';
import { readRequestInfo } from '@/lib/home-feed/context';
import { fail, feedFailFrom } from '@/lib/home-feed/http';
import { SUPPORTED_FEED_SCHEMAS } from '@/lib/home-feed/types';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { PROMO_CARD_TYPE, PROMO_CARD_VERSION, parsePromoClient } from '@/lib/promos';
import { HomeFeedService, SLOW_FEED_MS, type FeedTiming } from '@/lib/services/home-feed-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/home-feed?cards=header@1,campaign@1,…  (docs/HOME_FEED_SPEC.md §2)
 *   promo@1 clients (docs/PROMO_CARD_SPEC.md §6.1) add `promo@1` to cards plus
 *   &actions=open_screen@1,paywall@1,…&promoLayouts=hero,banner,compact
 *   (missing actions → only dismiss@1 → no promo with a primary button is sent).
 *
 * Headers: X-Feed-Schema: 1 (required), X-App-Platform (or X-Platform),
 * X-App-Version, X-App-Build, x-client-timezone.
 * 200 → the schema-1 layout (not the {success,data} envelope — the spec body).
 * 400 → missing/unsupported X-Feed-Schema or empty `cards`. Errors use the
 * standard envelope; clients fall back to their cached/default layout.
 *
 * Latency: this is the apps' first screen. Shared tables (rules, campaigns,
 * flags) are cached per instance and prewarmed alongside auth; per-user context
 * is one parallel round capped at 250 ms. Server-Timing reports auth / context
 * / total, slow requests log a breakdown, and each decision row stores server_ms.
 */
export async function GET(request: NextRequest) {
  const started = performance.now();
  HomeFeedService.prewarm();
  try {
    const user = await requireMobileAuth(request);
    const timing: FeedTiming = { authMs: Math.round(performance.now() - started) };

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

    const info = readRequestInfo(request);
    const promoClient = parsePromoClient({
      cardsSupportPromo: (support.get(PROMO_CARD_TYPE) ?? 0) >= PROMO_CARD_VERSION,
      actions: request.nextUrl.searchParams.get('actions'),
      promoLayouts: request.nextUrl.searchParams.get('promoLayouts'),
    });
    const feed = await HomeFeedService.getFeed(user, info, support, { timing, promoClient });
    timing.totalMs = Math.round(performance.now() - started);
    const response = NextResponse.json(feed, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Server-Timing': `auth;dur=${timing.authMs}, ctx;dur=${timing.contextMs ?? 0}, total;dur=${timing.totalMs}`,
      },
    });
    if (timing.totalMs > SLOW_FEED_MS) {
      console.warn(`[home-feed] slow total=${timing.totalMs}ms auth=${timing.authMs}ms ctx=${timing.contextMs}ms platform=${info.platform ?? '-'}`);
    }
    return await addAutoRefreshHeaders(request, response, user);
  } catch (error) {
    return feedFailFrom(error, 'get');
  }
}
