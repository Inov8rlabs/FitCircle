import { type NextRequest } from 'next/server';

import { SecurityAdminService } from '@/lib/security/admin-service';
import { ok, requireSecurityAdmin, securityFailFrom } from '@/lib/security/http';

export const dynamic = 'force-dynamic';

/** GET /api/admin/security/summary — tiles (24h, 7d), signals, attack status, kill switch. docs/SECURITY_TELEMETRY.md */
export async function GET(request: NextRequest) {
  try {
    await requireSecurityAdmin(request);
    return ok(await SecurityAdminService.summary());
  } catch (error) {
    return securityFailFrom(error, 'summary');
  }
}
