import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { filtersSchema } from '@/lib/engage/schema';
import { EngageSegmentService } from '@/lib/services/engage-segment-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  filters: filtersSchema.default([]),
  segmentId: z.string().uuid().nullish(),
  platforms: z.array(z.enum(['ios', 'android', 'web'])).optional(),
});

/**
 * POST /api/admin/engage/segments/estimate { filters, segmentId?, platforms? } →
 * { count, approximate, scanned, total, byPlatform }. Scans ≤ 50k users.
 * With segmentId and no extra filters the segment's stored estimate is refreshed.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = bodySchema.parse(await readJson(request));
    const persist = !!body.segmentId && body.filters.length === 0 && !body.platforms?.length;
    return ok(await EngageSegmentService.estimate(body.filters, { segmentId: body.segmentId ?? null, platforms: body.platforms, persist }));
  } catch (error) {
    return campaignFailFrom(error, 'engage-estimate');
  }
}
