import { type NextRequest } from 'next/server';

import { ok, readJson, remoteConfigFailFrom, requireRemoteConfigAdmin } from '@/lib/remote-config/http';
import { TrialSyncService } from '@/lib/services/trial-sync';

import { trialApplySchema } from '../schema';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/admin/trial-sync/apply {days, planHash} — runs the previewed plan when the live state still
 * hashes to planHash (409 PLAN_STALE otherwise, with the fresh plan in error.details.plan). Changes the
 * live App Store / Google Play offers and remote config; audited with X-Admin-Actor.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireRemoteConfigAdmin(request, { mutating: true });
    const { days, planHash } = trialApplySchema.parse(await readJson(request));
    return ok(await TrialSyncService.fromEnv().apply(days, planHash, { email: actor.email }));
  } catch (error) {
    return remoteConfigFailFrom(error, 'trial-sync/apply');
  }
}
