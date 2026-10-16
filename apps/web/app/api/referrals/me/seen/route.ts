import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { ReferralService } from '@/lib/services/referral-service';
import { createServerSupabase } from '@/lib/supabase-server';

const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

/** POST /api/referrals/me/seen { ids } — marks celebrated rewards as seen. Cookie auth. */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Not signed in' }, meta: null },
        { status: 401 }
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'ids must be a non-empty uuid array' }, meta: null },
        { status: 400 }
      );
    }

    const updated = await ReferralService.markRewardsSeen(user.id, parsed.data.ids);
    return NextResponse.json({
      success: true,
      data: { updated },
      error: null,
      meta: { requestTime: Date.now() - startTime },
    });
  } catch (error) {
    console.error('[POST /api/referrals/me/seen]', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL', message: 'Could not update rewards' }, meta: null },
      { status: 500 }
    );
  }
}
