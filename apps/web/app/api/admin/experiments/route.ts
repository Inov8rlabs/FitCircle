import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { experimentsFailFrom, ok, readJson, requireExperimentsAdmin } from '@/lib/experiments/http';
import { createExperimentSchema, patchExperimentSchema } from '@/lib/experiments/model';
import { ExperimentService } from '@/lib/experiments/service';

export const dynamic = 'force-dynamic';

/**
 * Admin Tools "Experiments" module (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.4–§6.5, contract in §6.8).
 * Auth: Bearer ADMIN_API_SECRET + X-Admin-Actor (required on writes), or an is_admin session.
 */

/** GET /api/admin/experiments → { experiments: [Experiment & { counts }] } */
export async function GET(request: NextRequest) {
  try {
    await requireExperimentsAdmin(request);
    return ok({ experiments: await ExperimentService.list() });
  } catch (error) {
    return experimentsFailFrom(error, 'list');
  }
}

/** POST /api/admin/experiments { key, name, description?, arms, trafficPct?, audience?, fallbackArm } → 201 ExperimentDetail (status draft, random salt). */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireExperimentsAdmin(request, { mutating: true });
    const input = createExperimentSchema.parse(await readJson(request));
    return ok(await ExperimentService.create(input, actor.email), undefined, 201);
  } catch (error) {
    return experimentsFailFrom(error, 'create');
  }
}

/** PATCH /api/admin/experiments { key, ...patch } → ExperimentDetail. Same as PATCH /api/admin/experiments/{key}. */
export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireExperimentsAdmin(request, { mutating: true });
    const body = await readJson(request);
    const key = z.string().min(1).max(64).parse(body?.key);
    const { key: _key, ...rest } = body ?? {};
    return ok(await ExperimentService.update(key, patchExperimentSchema.parse(rest), actor.email));
  } catch (error) {
    return experimentsFailFrom(error, 'update');
  }
}
