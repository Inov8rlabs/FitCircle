/**
 * Admin gate for /api/admin/releases/** — the same gate as /api/admin/ads
 * (ADMIN_API_SECRET bearer + X-Admin-Actor from Admin Tools, or an is_admin
 * session). Mutations made with the secret must name the actor.
 */
import { type NextResponse } from 'next/server';

import { campaignFailFrom } from '@/lib/campaigns/http';

export { requireAdsAdmin as requireReleasesAdmin } from '@/lib/ads/http';
export { ok, readJson } from '@/lib/campaigns/http';

export function releasesFailFrom(error: unknown, label: string): NextResponse {
  return campaignFailFrom(error, `releases/${label}`);
}
