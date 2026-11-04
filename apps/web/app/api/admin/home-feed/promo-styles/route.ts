import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok } from '@/lib/home-feed/http';
import { PromoStyleService } from '@/lib/services/promo-style-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/home-feed/promo-styles → { config, version (publish's baseVersion), source, presets, looks,
 * promos (+ creatives with theme/layout), thresholds, killSwitch, lastChange } (docs/PROMO_BUTTON_STYLE_SPEC.md §7).
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await PromoStyleService.state());
  } catch (error) {
    return feedFailFrom(error, 'admin-promo-styles');
  }
}
