/**
 * Admin gate for /api/admin/ads/** — the same gate as /api/admin/campaigns
 * (ADMIN_API_SECRET bearer, mobile bearer, or cookie session + is_admin).
 *
 * The admin app (admintools) calls these routes server-to-server with the
 * secret and identifies the signed-in admin with `X-Admin-Actor: <email>`.
 * Mutating calls made with the secret must carry it (400 missing_actor);
 * read-only GETs may omit it. No CORS: browser callers are same-origin only.
 */
import { type NextRequest, type NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { CampaignError, campaignFailFrom } from '@/lib/campaigns/http';

export { ok, readJson } from '@/lib/campaigns/http';

export interface AdsActor {
  userId: string | null;
  email: string | null;
  viaSecret: boolean;
}

export async function requireAdsAdmin(request: NextRequest, opts: { mutating?: boolean } = {}): Promise<AdsActor> {
  const caller = await requireAdmin(request);
  if (caller.viaSecret && opts.mutating && !caller.actorEmail) {
    throw new CampaignError(400, 'missing_actor', 'X-Admin-Actor (admin email) is required for changes made with the API secret');
  }
  // Secret calls: userId is the admin profile X-Admin-Actor resolved to (else null).
  return { userId: caller.userId, email: caller.actorEmail, viaSecret: caller.viaSecret };
}

export function adsFailFrom(error: unknown, label: string): NextResponse {
  return campaignFailFrom(error, `ads/${label}`);
}
