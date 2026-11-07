import { type NextRequest } from 'next/server';

import { SecurityAdminService } from '@/lib/security/admin-service';
import { ok, requireSecurityAdmin, securityFailFrom } from '@/lib/security/http';

export const dynamic = 'force-dynamic';

/** GET /api/admin/security/offenders?window=24h|7d&limit=10 — top asn, ipPrefix, country, deviceId. docs/SECURITY_TELEMETRY.md */
export async function GET(request: NextRequest) {
  try {
    await requireSecurityAdmin(request);
    return ok(await SecurityAdminService.offenders(request.nextUrl.searchParams));
  } catch (error) {
    return securityFailFrom(error, 'offenders');
  }
}
