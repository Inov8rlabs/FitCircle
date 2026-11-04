import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { RatingPromptAdminService } from '@/lib/services/rating-prompt-admin-service';

export const dynamic = 'force-dynamic';

/** POST /api/admin/rating-prompt/publish { baseVersion, config, enabled, summary, note? } → { config, enabled, version, change }. 409 STALE_DRAFT when the published settings changed since baseVersion; audited (experiment_audit_log, key config:rating_prompt). */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    return ok(await RatingPromptAdminService.publish(await readJson(request), caller));
  } catch (error) {
    return campaignFailFrom(error, 'admin-rating-prompt-publish');
  }
}
