import { type NextRequest, NextResponse } from 'next/server';

import { adminUnauthorized } from '@/lib/referrals/http';
import { ReferralService } from '@/lib/services/referral-service';

export const dynamic = 'force-dynamic';

/** POST /api/admin/referrals/{id}/approve — release a referral held for review. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = adminUnauthorized(request);
  if (denied) return denied;
  const { id } = await params;
  const approved = await ReferralService.approve(id, 'admin-api');
  return approved
    ? NextResponse.json({ approved: true })
    : NextResponse.json({ error: 'Referral not found or not in review' }, { status: 404 });
}
