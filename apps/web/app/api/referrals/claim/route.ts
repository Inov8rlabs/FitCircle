import { type NextRequest, NextResponse } from 'next/server';

import { CLEAR_FC_REF_COOKIE, claimWebInvite, resolveWebInvite } from '@/lib/referrals/web-claim';
import { createServerSupabase } from '@/lib/supabase-server';

/**
 * POST /api/referrals/claim { code?, ref?, circle?, source?: 'typed' } — web signup attribution
 * (source 'web'). Called by /register right after the account is created; falls
 * back to the `fc_ref` cookie set by the invite landing pages. Cookie auth.
 *
 * Always answers 200 for a signed-in caller (`claimed:false` + `reason` when the
 * invite can't be used) so signup UX never shows an error, and clears `fc_ref`.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Not signed in' }, meta: null },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const invite = resolveWebInvite(body, request.headers.get('cookie'));
  // The hub's "Got an invite code?" form sends source:'typed'; signup sends nothing ('web').
  const outcome = await claimWebInvite(user.id, invite, body?.source === 'typed' ? 'typed' : 'web');

  const response = NextResponse.json({
    success: true,
    data: outcome.claimed
      ? { claimed: true, ...outcome.result }
      : { claimed: false, reason: outcome.reason },
    error: null,
    meta: { requestTime: Date.now() - startTime },
  });
  // Keep the cookie only on an unexpected server error so a retry can still use it.
  if (outcome.claimed || outcome.reason !== 'ERROR') response.cookies.set(CLEAR_FC_REF_COOKIE);
  return response;
}
