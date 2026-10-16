import { type NextRequest, NextResponse } from 'next/server';

import { CampaignDeliveryService } from '@/lib/services/campaign-delivery-service';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/campaigns (hourly) — campaign push + email delivery
 * (docs/CAMPAIGNS_SPEC.md §5, §6). Idempotent: campaign_deliveries dedupes.
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await CampaignDeliveryService.runCron();
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[cron/campaigns] failed:', error?.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
