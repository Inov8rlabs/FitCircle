import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { feedFailFrom, ok } from '@/lib/home-feed/http';
import { PromoStyleService } from '@/lib/services/promo-style-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/home-feed/promo-styles/changes?limit= → { changes } newest first. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return ok(await PromoStyleService.changes(Number(request.nextUrl.searchParams.get('limit')) || 50));
  } catch (error) {
    return feedFailFrom(error, 'admin-promo-styles-changes');
  }
}
