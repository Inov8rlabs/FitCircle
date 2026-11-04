import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { RatingPromptAdminService } from '@/lib/services/rating-prompt-admin-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/rating-prompt/audience → { eligible, total, byReason, byTrigger, computedAt, truncated, note }: who is eligible right now. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await RatingPromptAdminService.audience());
  } catch (error) {
    return campaignFailFrom(error, 'admin-rating-prompt-audience');
  }
}
