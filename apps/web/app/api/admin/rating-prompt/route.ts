import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { RatingPromptAdminService } from '@/lib/services/rating-prompt-admin-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/rating-prompt → { config, enabled, version (publish baseVersion), source, defaults, killSwitch, limits, triggers, lastChange, propagation } (docs/RATING_PROMPT.md §5). */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await RatingPromptAdminService.state());
  } catch (error) {
    return campaignFailFrom(error, 'admin-rating-prompt');
  }
}
