import { type NextRequest } from 'next/server';

import { experimentsFailFrom, ok, readJson, requireExperimentsAdmin } from '@/lib/experiments/http';
import { overrideInputSchema, overrideRemoveSchema } from '@/lib/experiments/model';
import { ExperimentService } from '@/lib/experiments/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/admin/experiments/{key}/overrides → { overrides: [...] } */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    await requireExperimentsAdmin(request);
    const { key } = await params;
    await ExperimentService.require(key);
    return ok({ overrides: await ExperimentService.listOverrides(key) });
  } catch (error) {
    return experimentsFailFrom(error, 'overrides/list');
  }
}

/** POST /api/admin/experiments/{key}/overrides { email | userId, arm, note? } → { overrides } (QA: force an arm). */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const actor = await requireExperimentsAdmin(request, { mutating: true });
    const { key } = await params;
    return ok(await ExperimentService.setOverride(key, overrideInputSchema.parse(await readJson(request)), actor.email));
  } catch (error) {
    return experimentsFailFrom(error, 'overrides/set');
  }
}

/** DELETE /api/admin/experiments/{key}/overrides { email | userId } (body, or ?email= / ?userId=) → { overrides } */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const actor = await requireExperimentsAdmin(request, { mutating: true });
    const { key } = await params;
    const q = request.nextUrl.searchParams;
    const fromQuery = q.has('email') || q.has('userId') ? { ...(q.get('email') ? { email: q.get('email')! } : {}), ...(q.get('userId') ? { userId: q.get('userId')! } : {}) } : null;
    const input = overrideRemoveSchema.parse(fromQuery ?? (await readJson(request)));
    return ok(await ExperimentService.removeOverride(key, input, actor.email));
  } catch (error) {
    return experimentsFailFrom(error, 'overrides/remove');
  }
}
