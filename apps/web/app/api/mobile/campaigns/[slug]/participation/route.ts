import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { requireUser } from '@/lib/campaigns/admin-auth';
import { iconCompatFor } from '@/lib/design/icon-compat';
import { campaignFailFrom, ok, readJson } from '@/lib/campaigns/http';
import { CampaignService } from '@/lib/services/campaign-service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ joined: z.boolean().nullish(), reminders: z.boolean().nullish() });

/**
 * POST /api/mobile/campaigns/{slug}/participation { joined?, reminders? } → CampaignView.
 * reminders: true implies joined; joined: false clears reminders.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const startTime = Date.now();
  try {
    const profile = await requireUser(request);
    const { slug } = await params;
    const body = bodySchema.parse(await readJson(request));
    const view = await CampaignService.setParticipation(profile, request.headers.get('x-client-timezone'), slug, body);
    return ok(iconCompatFor(request, view), startTime);
  } catch (error) {
    return campaignFailFrom(error, 'participation');
  }
}
