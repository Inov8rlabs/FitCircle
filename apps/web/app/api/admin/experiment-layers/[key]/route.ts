import { type NextRequest } from 'next/server';

import { experimentsFailFrom, ok, readJson, requireExperimentsAdmin } from '@/lib/experiments/http';
import { patchLayerSchema } from '@/lib/experiments/model';
import { ExperimentService } from '@/lib/experiments/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/admin/experiment-layers/{key} → LayerDetail { layer, experiments: [slice + status], freeRanges } */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireExperimentsAdmin(request);
    const { key } = await params;
    return ok(await ExperimentService.layerDetail(key));
  } catch (error) {
    return experimentsFailFrom(error, 'layers/detail');
  }
}

/** PATCH /api/admin/experiment-layers/{key} { name?, description? } → LayerDetail. The salt is immutable. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const actor = await requireExperimentsAdmin(request, { mutating: true });
    const { key } = await params;
    return ok(await ExperimentService.updateLayer(key, patchLayerSchema.parse(await readJson(request)), actor.email));
  } catch (error) {
    return experimentsFailFrom(error, 'layers/update');
  }
}
