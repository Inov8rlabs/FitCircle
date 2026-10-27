import { type NextRequest } from 'next/server';

import { ok, readJson, releasesFailFrom, requireReleasesAdmin } from '@/lib/releases/http';
import { ReleaseService } from '@/lib/releases/services/release-service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/releases/:id → ReleaseDetail { release, events (newest first) }. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireReleasesAdmin(request);
    return ok(await ReleaseService.get((await params).id));
  } catch (error) {
    return releasesFailFrom(error, 'get');
  }
}

/**
 * PATCH /api/admin/releases/:id { internalNotes?, knownIssues?, whatsNew?, links?, commits?,
 * migrations?, releasedAt?, status?, note? } → ReleaseDetail. A status change appends a
 * manual release_events row. Store-synced fields may be overwritten again by the next sync.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const actor = await requireReleasesAdmin(request, { mutating: true });
    return ok(await ReleaseService.update((await params).id, await readJson(request), actor));
  } catch (error) {
    return releasesFailFrom(error, 'update');
  }
}
