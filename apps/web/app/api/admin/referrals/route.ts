import { type NextRequest, NextResponse } from 'next/server';

import { adminUnauthorized } from '@/lib/referrals/http';
import type { ReferralStatus } from '@/lib/referrals/types';
import { ReferralService } from '@/lib/services/referral-service';

export const dynamic = 'force-dynamic';

const STATUSES: ReferralStatus[] = ['pending', 'qualified', 'review', 'rejected', 'revoked'];

/**
 * Admin API — referral review queue. `Authorization: Bearer $ADMIN_API_SECRET`.
 *   GET  /api/admin/referrals?status=review          → referrals in that status
 *   POST /api/admin/referrals/{id}/approve            → review → qualified (+ rewards)
 *   POST /api/admin/referrals/{id}/revoke {reason}    → clawback
 */
export async function GET(request: NextRequest) {
  const denied = adminUnauthorized(request);
  if (denied) return denied;
  const status = (request.nextUrl.searchParams.get('status') ?? 'review') as ReferralStatus;
  if (!STATUSES.includes(status)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
  return NextResponse.json({ referrals: await ReferralService.listForReview(status) });
}
