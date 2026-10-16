import { type NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { CampaignError, campaignFailFrom, ok } from '@/lib/campaigns/http';
import { CampaignService, MAX_ART_BYTES } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/campaigns/{id}/art — multipart { slot, file (png/jpg ≤ 8 MB;
 * exact size for appStoreCard 1920×1080 / appStoreDetails 1080×1920), generated }
 * → AdminCampaign. Stored at campaign-art/{id}/{slot}-{timestamp}.{png|jpg}.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const caller = await requireAdmin(request);
    const { id } = await params;
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new CampaignError(400, 'VALIDATION_ERROR', 'Expected multipart/form-data');
    }
    const slot = String(form.get('slot') ?? '');
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new CampaignError(400, 'VALIDATION_ERROR', 'file is required');
    if ((file as Blob).size > MAX_ART_BYTES) throw new CampaignError(413, 'FILE_TOO_LARGE', 'Art must be 8 MB or smaller');
    const bytes = new Uint8Array(await (file as Blob).arrayBuffer());
    const generated = String(form.get('generated') ?? 'false') === 'true';
    return ok(await CampaignService.uploadArt(id, slot, bytes, generated, caller.userId, request.headers.get('x-client-timezone')));
  } catch (error) {
    return campaignFailFrom(error, 'admin-art');
  }
}
