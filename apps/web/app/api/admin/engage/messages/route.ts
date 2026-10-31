import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { EngageMessageService } from '@/lib/services/engage-message-service';
import { EngageStatsService } from '@/lib/services/engage-stats-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/engage/messages?channel&status&campaignId → { messages }.
 * Each message carries `summary` (last 7 days: daily impressions for the
 * sparkline, unique impressions/clicks, ctr, conversions, conversionRate) and
 * the same numbers as `stats` in the shape the tool's list reads.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const sp = request.nextUrl.searchParams;
    const messages = await EngageMessageService.list({ channel: sp.get('channel'), status: sp.get('status'), campaignId: sp.get('campaignId') });
    const sums = await EngageStatsService.summaries(messages);
    return ok({
      messages: messages.map((m) => {
        const { conversionDates: _d, ...summary } = sums.get(m.id)!;
        return {
          ...m,
          summary,
          stats: { impressions: summary.uniqueImpressions, clicks: summary.uniqueClicks, ctr: summary.ctr, conversions: summary.conversions, daily: summary.daily },
        };
      }),
    });
  } catch (error) {
    return campaignFailFrom(error, 'engage-messages');
  }
}

/** POST /api/admin/engage/messages (MessageInput) → EngageMessage (draft) */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    return ok(await EngageMessageService.create(await readJson(request), caller.userId), undefined, 201);
  } catch (error) {
    return campaignFailFrom(error, 'engage-message-create');
  }
}
