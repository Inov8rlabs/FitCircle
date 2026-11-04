import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok, readJson } from '@/lib/home-feed/http';
import { PromoStyleService } from '@/lib/services/promo-style-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/home-feed/promo-styles/publish { baseVersion, config, summary, note? } → { config, version, change }.
 * 409 STALE_DRAFT when the published looks changed since baseVersion; audited with X-Admin-Actor
 * (experiment_audit_log, key config:promo_styles).
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    return ok(await PromoStyleService.publish(await readJson(request), caller));
  } catch (error) {
    return feedFailFrom(error, 'admin-promo-styles-publish');
  }
}
