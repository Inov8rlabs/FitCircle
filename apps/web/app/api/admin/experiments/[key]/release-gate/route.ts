import { type NextRequest } from 'next/server';

import { experimentsFailFrom, ok, requireExperimentsAdmin } from '@/lib/experiments/http';
import { ExperimentService } from '@/lib/experiments/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

/**
 * POST /api/admin/experiments/{key}/release-gate → { released, status }
 * Emergency (§5.5/§6.5): every profiles.onboarding_gate 'subscription_required'
 * → 'none', and the experiment is paused if running. Audited. Idempotent.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const actor = await requireExperimentsAdmin(request, { mutating: true });
    const { key } = await params;
    return ok(await ExperimentService.releaseGate(key, actor.email));
  } catch (error) {
    return experimentsFailFrom(error, 'release-gate');
  }
}
