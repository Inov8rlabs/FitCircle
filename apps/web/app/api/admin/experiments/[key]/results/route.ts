import { type NextRequest } from 'next/server';

import { CampaignError } from '@/lib/campaigns/http';
import { experimentsFailFrom, ok, requireExperimentsAdmin } from '@/lib/experiments/http';
import type { SegmentDimension } from '@/lib/experiments/results';
import { ExperimentResultsService } from '@/lib/experiments/results-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ key: string }> };
const SEGMENTS: readonly SegmentDimension[] = ['platform', 'channel', 'country'];

/**
 * GET /api/admin/experiments/{key}/results?segment=platform|channel|country&fresh=1
 * → ExperimentResults (§6.6). Cached 15 min per (key, segment); fresh=1 recomputes.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireExperimentsAdmin(request);
    const { key } = await params;
    const q = request.nextUrl.searchParams;
    const raw = q.get('segment');
    if (raw && !SEGMENTS.includes(raw as SegmentDimension)) {
      throw new CampaignError(400, 'VALIDATION_ERROR', `segment must be one of ${SEGMENTS.join(', ')}`);
    }
    const fresh = q.get('fresh') === '1' || q.get('fresh') === 'true';
    return ok(await ExperimentResultsService.results(key, { segment: (raw as SegmentDimension | null) ?? null, fresh }));
  } catch (error) {
    return experimentsFailFrom(error, 'results');
  }
}
