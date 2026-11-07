import { type NextRequest } from 'next/server';

import { SecurityAdminService } from '@/lib/security/admin-service';
import { ok, requireSecurityAdmin, securityFailFrom } from '@/lib/security/http';

export const dynamic = 'force-dynamic';

/** GET /api/admin/security/events?kind&result&platform&before=<iso>&limit=50 — newest first. docs/SECURITY_TELEMETRY.md */
export async function GET(request: NextRequest) {
  try {
    await requireSecurityAdmin(request);
    return ok(await SecurityAdminService.events(request.nextUrl.searchParams));
  } catch (error) {
    return securityFailFrom(error, 'events');
  }
}
