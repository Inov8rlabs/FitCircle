import { type NextRequest } from 'next/server';

import { SecurityAdminService } from '@/lib/security/admin-service';
import { ok, requireSecurityAdmin, securityFailFrom } from '@/lib/security/http';

export const dynamic = 'force-dynamic';

/** GET /api/admin/security/timeseries?days=7 — hourly counts per kind. docs/SECURITY_TELEMETRY.md */
export async function GET(request: NextRequest) {
  try {
    await requireSecurityAdmin(request);
    return ok(await SecurityAdminService.timeseries(request.nextUrl.searchParams));
  } catch (error) {
    return securityFailFrom(error, 'timeseries');
  }
}
