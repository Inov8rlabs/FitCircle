import { type NextRequest } from 'next/server';

import { ok, remoteConfigFailFrom, requireRemoteConfigAdmin } from '@/lib/remote-config/http';
import { TrialSyncService } from '@/lib/services/trial-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** GET /api/admin/trial-sync — live store trials + remote config trial_days + in-sync (docs/TRIAL_SYNC.md §4). Store GETs only. */
export async function GET(request: NextRequest) {
  try {
    await requireRemoteConfigAdmin(request);
    return ok(await TrialSyncService.fromEnv().status());
  } catch (error) {
    return remoteConfigFailFrom(error, 'trial-sync');
  }
}
