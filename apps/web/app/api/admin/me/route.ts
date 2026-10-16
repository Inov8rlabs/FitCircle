import { type NextRequest } from 'next/server';

import { isAdminProfile, requireUser } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom, ok } from '@/lib/campaigns/http';

export const dynamic = 'force-dynamic';

/** GET /api/admin/me → { isAdmin } (web nav shows the Admin link). Any signed-in user. */
export async function GET(request: NextRequest) {
  try {
    const profile = await requireUser(request);
    return ok({ isAdmin: await isAdminProfile(profile), userId: profile.id });
  } catch (error) {
    return campaignFailFrom(error, 'admin-me');
  }
}
