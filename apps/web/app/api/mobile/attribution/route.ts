import { type NextRequest } from 'next/server';

import { attributionBodySchema } from '@/lib/ads/attribution';
import { AdsAttributionService } from '@/lib/ads/services/attribution-service';
import { readJson } from '@/lib/campaigns/http';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { fail, ok } from '@/lib/referrals/http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/attribution (ADS_CONSOLE_SPEC §4)
 * Body: { platform: 'ios'|'android', source, campaignId?, adGroupId?, keywordId?, adId?, clickDate?, country?, raw? }
 *
 * Idempotent, first touch wins: the first report is stored; later reports are
 * no-ops unless the stored row is `unknown`. Apple's mock campaign 1234567890
 * is stored with isTest=true (excluded from the ads console).
 * → { channel, source, campaignId, adGroupId, keywordId, adId, isTest, created, updated }
 */
export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireMobileAuth(request)).id;
  } catch {
    return fail(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
  const parsed = attributionBodySchema.safeParse(await readJson(request));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return fail(400, 'VALIDATION_ERROR', 'Invalid request body', { issues });
  }
  try {
    const { attribution: a, created, updated } = await AdsAttributionService.record(userId, parsed.data);
    return ok({
      channel: a.channel,
      platform: a.platform,
      source: a.source,
      campaignId: a.campaign_external_id,
      adGroupId: a.ad_group_external_id,
      keywordId: a.keyword_external_id,
      adId: a.ad_external_id,
      isTest: a.is_test,
      created,
      updated,
    });
  } catch (error: any) {
    console.error('[mobile/attribution] failed:', error?.message);
    return fail(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
  }
}
