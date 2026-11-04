import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';
import { RatingPromptAdminService } from '@/lib/services/rating-prompt-admin-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/rating-prompt/requests?limit= → { requests } newest prompt requests (one per user: their latest). */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await RatingPromptAdminService.requests(Number(request.nextUrl.searchParams.get('limit')) || 50));
  } catch (error) {
    return campaignFailFrom(error, 'admin-rating-prompt-requests');
  }
}
