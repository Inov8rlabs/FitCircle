import { type NextRequest } from 'next/server';

import { ok, readJson, remoteConfigFailFrom, requireRemoteConfigAdmin } from '@/lib/remote-config/http';
import { TrialSyncService } from '@/lib/services/trial-sync';

import { trialPlanSchema } from '../schema';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/admin/trial-sync/plan {days} — dry run: exact operations, validation, warnings, planHash. Writes nothing. */
export async function POST(request: NextRequest) {
  try {
    await requireRemoteConfigAdmin(request);
    const { days } = trialPlanSchema.parse(await readJson(request));
    return ok(await TrialSyncService.fromEnv().plan(days));
  } catch (error) {
    return remoteConfigFailFrom(error, 'trial-sync/plan');
  }
}
