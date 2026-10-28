import { type NextRequest } from 'next/server';

import { experimentsFailFrom, ok, readJson, requireExperimentsAdmin } from '@/lib/experiments/http';
import { createLayerSchema } from '@/lib/experiments/model';
import { ExperimentService } from '@/lib/experiments/service';

export const dynamic = 'force-dynamic';

/**
 * Mutual-exclusion layers (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.3, §6.8).
 * Auth: Bearer ADMIN_API_SECRET + X-Admin-Actor (required on writes), or an is_admin session.
 */

/** GET /api/admin/experiment-layers → { layers: [LayerDetail] } */
export async function GET(request: NextRequest) {
  try {
    await requireExperimentsAdmin(request);
    return ok({ layers: await ExperimentService.listLayers() });
  } catch (error) {
    return experimentsFailFrom(error, 'layers/list');
  }
}

/** POST /api/admin/experiment-layers { key, name, description? } → 201 LayerDetail (random, immutable salt). */
export async function POST(request: NextRequest) {
  try {
    const actor = await requireExperimentsAdmin(request, { mutating: true });
    return ok(await ExperimentService.createLayer(createLayerSchema.parse(await readJson(request)), actor.email), undefined, 201);
  } catch (error) {
    return experimentsFailFrom(error, 'layers/create');
  }
}
