import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { adminUnauthorized } from '@/lib/referrals/http';
import { ReferralService } from '@/lib/services/referral-service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ reason: z.string().min(1).max(200) });

/** POST /api/admin/referrals/{id}/revoke {reason} — fraud clawback (takes back the weeks it paid). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = adminUnauthorized(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  const { id } = await params;
  const revoked = await ReferralService.revoke(id, 'admin-api', parsed.data.reason);
  return revoked
    ? NextResponse.json({ revoked: true })
    : NextResponse.json({ error: 'Referral not found or already revoked' }, { status: 404 });
}
