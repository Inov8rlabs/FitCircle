import { type NextRequest } from 'next/server';

import { isYmd } from '@/lib/ads/dates';
import { parseConfidence } from '@/lib/ads/ga4/matcher';
import { adsFailFrom, ok, readJson, requireAdsAdmin } from '@/lib/ads/http';
import { Ga4AttributionService, MAX_BACKFILL_DAYS } from '@/lib/ads/services/ga4-attribution-service';
import { CampaignError } from '@/lib/campaigns/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function range(start: unknown, end: unknown): { start?: string; end?: string } {
  const s = typeof start === 'string' && start ? start : undefined;
  const e = typeof end === 'string' && end ? end : undefined;
  if ((s && !isYmd(s)) || (e && !isYmd(e)) || (s && e && s > e)) {
    throw new CampaignError(400, 'bad_range', `start/end must be YYYY-MM-DD with start <= end (at most ${MAX_BACKFILL_DAYS} days)`);
  }
  return { start: s, end: e };
}

/**
 * GET /api/admin/ads/ga4-attribution?start&end&minConfidence → Ga4SyncResult (dry run).
 * Per-user preview of what the GA4 sync would write (docs/ADS_ATTRIBUTION_GA4.md §8).
 * Runs even when the daily cron is switched off.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    const p = request.nextUrl.searchParams;
    const data = await Ga4AttributionService.run({ ...range(p.get('start'), p.get('end')), minConfidence: parseConfidence(p.get('minConfidence')), dryRun: true, force: true });
    return ok(data);
  } catch (error) {
    return adsFailFrom(error, 'ga4-attribution-preview');
  }
}

/**
 * POST /api/admin/ads/ga4-attribution { start?, end?, minConfidence?, userIds? } → Ga4SyncResult.
 * Applies the plan (re-computed server side, every write guarded). `userIds`
 * limits the writes to the rows the admin reviewed in the dry run.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAdsAdmin(request, { mutating: true });
    const body = await readJson(request);
    let userIds: string[] | undefined;
    if (body?.userIds !== undefined) {
      if (!Array.isArray(body.userIds) || body.userIds.length > 2000 || !body.userIds.every((u: unknown) => typeof u === 'string' && UUID_RE.test(u))) {
        throw new CampaignError(400, 'bad_user_ids', 'userIds must be an array of user UUIDs (max 2000)');
      }
      userIds = body.userIds;
      if (!userIds!.length) throw new CampaignError(400, 'bad_user_ids', 'userIds is empty: nothing to apply');
    }
    const data = await Ga4AttributionService.run({
      ...range(body?.start, body?.end),
      minConfidence: parseConfidence(body?.minConfidence),
      userIds,
      dryRun: false,
      force: true,
      actorEmail: actor.email,
    });
    return ok(data);
  } catch (error) {
    return adsFailFrom(error, 'ga4-attribution-apply');
  }
}
