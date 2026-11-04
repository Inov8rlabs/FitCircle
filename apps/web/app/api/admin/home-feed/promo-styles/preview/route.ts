import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok, readJson } from '@/lib/home-feed/http';
import { PromoStyleService } from '@/lib/services/promo-style-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/home-feed/promo-styles/preview { config?, platform, version?, legacyVersion? }
 * → per system promo creative: the props today's apps get + per look variant the props 1.1.3+ get, with
 * contrast issues; draft validity, warnings and changes. Read-only.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await PromoStyleService.preview(await readJson(request)));
  } catch (error) {
    return feedFailFrom(error, 'admin-promo-styles-preview');
  }
}
