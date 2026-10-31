import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { CampaignError, campaignFailFrom, ok } from '@/lib/campaigns/http';
import { EngageAssetService } from '@/lib/services/engage-asset-service';

export const dynamic = 'force-dynamic';

/** GET /api/admin/engage/assets?q&tag&cursor&limit → { assets, nextCursor } */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const sp = request.nextUrl.searchParams;
    return ok(await EngageAssetService.list({ q: sp.get('q'), tag: sp.get('tag'), cursor: sp.get('cursor'), limit: Number(sp.get('limit')) || undefined }));
  } catch (error) {
    return campaignFailFrom(error, 'engage-assets');
  }
}

/**
 * POST /api/admin/engage/assets — multipart: file, variants[] (WebP files),
 * metadata (JSON: { name, sha256, dominantColor, tags, alt }) → { asset, deduped }.
 * 201 when new, 200 when the same bytes already existed.
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await requireAdmin(request);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new CampaignError(400, 'VALIDATION_ERROR', 'Expected multipart/form-data');
    }
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      throw new CampaignError(400, 'VALIDATION_ERROR', 'file is required');
    }
    let meta: Record<string, any> = {};
    const rawMeta = form.get('metadata');
    if (typeof rawMeta === 'string' && rawMeta) {
      try {
        meta = JSON.parse(rawMeta);
      } catch {
        meta = {};
      }
    }
    const variants = [];
    for (const v of [...form.getAll('variants[]'), ...form.getAll('variants')]) {
      if (typeof v !== 'string') variants.push({ bytes: new Uint8Array(await (v as Blob).arrayBuffer()) });
    }
    const out = await EngageAssetService.upload(
      { file: new Uint8Array(await (file as Blob).arrayBuffer()), fileName: (file).name ?? null, variants, meta },
      caller.userId
    );
    return ok(out, undefined, out.deduped ? 200 : 201);
  } catch (error) {
    return campaignFailFrom(error, 'engage-assets-upload');
  }
}
