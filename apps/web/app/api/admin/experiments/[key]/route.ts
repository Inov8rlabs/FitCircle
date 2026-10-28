import { type NextRequest } from 'next/server';

import { experimentsFailFrom, ok, readJson, requireExperimentsAdmin } from '@/lib/experiments/http';
import { patchExperimentSchema } from '@/lib/experiments/model';
import { ExperimentService } from '@/lib/experiments/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/admin/experiments/{key} → ExperimentDetail { experiment, counts, overrides, audit } */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireExperimentsAdmin(request);
    const { key } = await params;
    return ok(await ExperimentService.detail(key));
  } catch (error) {
    return experimentsFailFrom(error, 'detail');
  }
}

/** PATCH /api/admin/experiments/{key} { name?, description?, status?, arms?, trafficPct?, audience?, fallbackArm?, winnerArm? } → ExperimentDetail */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const actor = await requireExperimentsAdmin(request, { mutating: true });
    const { key } = await params;
    return ok(await ExperimentService.update(key, patchExperimentSchema.parse(await readJson(request)), actor.email));
  } catch (error) {
    return experimentsFailFrom(error, 'update');
  }
}
