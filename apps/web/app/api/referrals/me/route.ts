import { NextResponse } from 'next/server';

import { ReferralService } from '@/lib/services/referral-service';
import { createServerSupabase } from '@/lib/supabase-server';

/**
 * GET /api/referrals/me — the web invite hub (same payload as GET /api/mobile/referrals).
 * Cookie (Supabase session) auth.
 */
export async function GET() {
  const startTime = Date.now();
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Sign in to see your invites' }, meta: null },
        { status: 401 }
      );
    }

    const hub = await ReferralService.getHub(user.id);
    return NextResponse.json({
      success: true,
      data: hub,
      error: null,
      meta: { requestTime: Date.now() - startTime },
    });
  } catch (error) {
    console.error('[GET /api/referrals/me]', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL', message: 'Could not load your invites' }, meta: null },
      { status: 500 }
    );
  }
}
