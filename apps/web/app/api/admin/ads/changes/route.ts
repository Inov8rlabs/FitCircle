import { type NextRequest } from 'next/server';

import { adsFailFrom, ok, readJson, requireAdsAdmin } from '@/lib/ads/http';
import { AdsChangeService } from '@/lib/ads/services/change-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/ads/changes?limit → { changes: AdChangeLogEntry[] } (audit log, newest first). */
export async function GET(request: NextRequest) {
  try {
    await requireAdsAdmin(request);
    const limit = Number(request.nextUrl.searchParams.get('limit') ?? 100);
    return ok({ changes: await AdsChangeService.list(limit) });
  } catch (error) {
    return adsFailFrom(error, 'changes-list');
  }
}

/**
 * POST /api/admin/ads/changes { channel, level, externalId, field, value, dryRun?, force?, expectedOldValue? }
 * → AdChangeResult. Guardrail rejections are 200 with ok=false (the result is the answer);
 * a failed network write is 502.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireAdsAdmin(request, { mutating: true });
    const result = await AdsChangeService.change(await readJson(request), actor);
    return ok(result, undefined, result.outcome === 'failed' ? 502 : 200);
  } catch (error) {
    return adsFailFrom(error, 'changes-apply');
  }
}
