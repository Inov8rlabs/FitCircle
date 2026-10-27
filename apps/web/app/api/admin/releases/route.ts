import { type NextRequest } from 'next/server';

import { ok, readJson, releasesFailFrom, requireReleasesAdmin } from '@/lib/releases/http';
import { ReleaseService } from '@/lib/releases/services/release-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/releases?platform&track&status&from&to&includeTesting&limit
 * → ReleasesList { releases (newest first), liveNow, sync }.
 * Without includeTesting (or track) only store tracks + backend production are listed.
 */
export async function GET(request: NextRequest) {
  try {
    await requireReleasesAdmin(request);
    const q = request.nextUrl.searchParams;
    const flag = q.get('includeTesting');
    return ok(
      await ReleaseService.list({
        platform: q.get('platform'),
        track: q.get('track'),
        status: q.get('status'),
        from: q.get('from'),
        to: q.get('to'),
        includeTesting: flag === '1' || flag === 'true',
        limit: q.has('limit') ? Number(q.get('limit')) : undefined,
      })
    );
  } catch (error) {
    return releasesFailFrom(error, 'list');
  }
}

/** POST /api/admin/releases { platform, track, version, build?, status, ... } → ReleaseDetail (201; 409 DUPLICATE). */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireReleasesAdmin(request, { mutating: true });
    return ok(await ReleaseService.create(await readJson(request), actor), undefined, 201);
  } catch (error) {
    return releasesFailFrom(error, 'create');
  }
}
