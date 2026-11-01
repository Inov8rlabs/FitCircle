import { type NextRequest, NextResponse } from 'next/server';

import {
  CLEAR_FC_REF_COOKIE,
  PENDING_INVITE_METADATA_KEY,
  claimWebInvite,
  resolveWebInvite,
} from '@/lib/referrals/web-claim';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { createServerSupabase } from '@/lib/supabase-server';

/**
 * POST /api/referrals/claim { code?, ref?, circle?, source?: 'typed' } — accept
 * an invite on the web (source 'web'): referral attribution AND, for a circle
 * invite, joining the circle. Called by /register right after the account is
 * created, by /onboarding (email-confirmation signups) and by the hub's
 * "Got an invite code?" form. Falls back to the `fc_ref` cookie set by the
 * invite landing pages, then to the invite stored in the user's signup
 * metadata. Cookie auth.
 *
 * Always answers 200 for a signed-in caller (`claimed:false` + `reason` when the
 * attribution can't be used) so signup UX never shows an error. `circleJoin`
 * says whether the person is now in the circle. Clears `fc_ref` once settled.
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
  const invite = resolveWebInvite(body, request.headers.get('cookie'), user.user_metadata ?? null);
  // The hub's "Got an invite code?" form sends source:'typed'; signup sends nothing ('web').
  const outcome = await claimWebInvite(user.id, invite, body?.source === 'typed' ? 'typed' : 'web');

  const response = NextResponse.json({
    success: true,
    data: outcome.claimed
      ? { claimed: true, ...outcome.result, circleJoin: outcome.circleJoin }
      : { claimed: false, reason: outcome.reason, circleJoin: outcome.circleJoin },
    error: null,
    meta: { requestTime: Date.now() - startTime },
  });
  // Keep the cookie only while something is still worth retrying (server error).
  if (outcome.settled) {
    response.cookies.set(CLEAR_FC_REF_COOKIE);
    // The signup-metadata copy has done its job too.
    if (user.user_metadata?.[PENDING_INVITE_METADATA_KEY]) {
      await createAdminSupabase()
        .auth.admin.updateUserById(user.id, { user_metadata: { [PENDING_INVITE_METADATA_KEY]: null } })
        .catch((err: unknown) => console.error('[referrals/claim] metadata cleanup failed', (err as Error)?.message));
    }
  }
  return response;
}
