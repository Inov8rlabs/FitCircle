import { type NextRequest, NextResponse } from 'next/server';

import { Ga4ConversionService, type SendMode } from '@/lib/ads/services/ga4-conversion-service';
import { adminUnauthorized } from '@/lib/referrals/http';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/ads/ga4-conversions — sweep / backfill of server-side GA4
 * subscription conversions (docs/GA4_SERVER_CONVERSIONS.md).
 *
 * Auth: CRON_SECRET bearer or ADMIN_API_SECRET bearer.
 *
 * DRY-RUN BY DEFAULT: lists what would be sent and why the rest is not
 * (missing app instance id, test user, too old, …), without writing.
 *   ?apply=1      send (needs GA4_SERVER_CONVERSIONS_ENABLED=true + config)
 *   ?validate=1   post each payload to /debug/mp/collect instead (needs config; writes nothing)
 *   ?hours=N      look-back, capped at GA4's backdating limit (≈ 71.75 h)
 *   ?limit=N      max events scanned (default 500)
 * Events older than the window are never sent: GA4 would re-stamp them to
 * "72 h ago". Already-sent events are skipped (ga4_conversion_sends).
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request) && adminUnauthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const flag = (k: string) => ['1', 'true'].includes((params.get(k) ?? '').toLowerCase());
  const mode: SendMode = flag('apply') ? 'apply' : flag('validate') ? 'validate' : 'dry_run';
  const hours = Number(params.get('hours'));
  const limit = Number(params.get('limit'));
  try {
    const data = await Ga4ConversionService.sweep({
      mode,
      windowMs: Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[cron/ads/ga4-conversions] failed:', error?.message);
    return NextResponse.json({ success: false, error: String(error?.message ?? 'Internal server error').slice(0, 300) }, { status: 500 });
  }
}
