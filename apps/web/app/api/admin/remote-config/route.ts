import { type NextRequest } from 'next/server';

import { ok, remoteConfigFailFrom, requireRemoteConfigAdmin } from '@/lib/remote-config/http';
import { RemoteConfigService } from '@/lib/remote-config/service';

export const dynamic = 'force-dynamic';

/**
 * Admin Tools "Remote config" (docs/TRIAL_FIRST_SPEC.md §6.5).
 * Auth: Bearer ADMIN_API_SECRET + X-Admin-Actor (required on writes), or an is_admin session.
 *
 * GET /api/admin/remote-config → { keys: [{ key, type, min, max, unit, description, codeDefault,
 *   default: {value, updatedBy, updatedAt} | null, rules: [...] }] }
 */
export async function GET(request: NextRequest) {
  try {
    await requireRemoteConfigAdmin(request);
    return ok(await RemoteConfigService.listKeys());
  } catch (error) {
    return remoteConfigFailFrom(error, 'list');
  }
}
