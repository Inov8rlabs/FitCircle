/** Envelope + auth for /api/admin/security/** (same gate as the other Admin Tools APIs). */
import { type NextRequest, type NextResponse } from 'next/server';

import { adsFailFrom, requireAdsAdmin } from '@/lib/ads/http';
import { fail } from '@/lib/referrals/http';

import { SecurityAdminError } from './admin-service';

export { ok } from '@/lib/referrals/http';

/** ADMIN_API_SECRET bearer (+ optional X-Admin-Actor on reads), or an is_admin session. */
export function requireSecurityAdmin(request: NextRequest) {
  return requireAdsAdmin(request);
}

export function securityFailFrom(error: unknown, label: string): NextResponse {
  if (error instanceof SecurityAdminError) return fail(error.status, error.code, error.message);
  return adsFailFrom(error, `security/${label}`);
}
