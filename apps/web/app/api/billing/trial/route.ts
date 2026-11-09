import { NextResponse } from 'next/server';

import { BillingService } from '@/lib/services/billing-service';
import { EntitlementService } from '@/lib/services/entitlement-service';
import { createServerSupabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/billing/trial → { trialDays, eligible } (web session).
 * Whether a Stripe checkout started now would carry the free trial (docs/TRIAL_FIRST_SPEC.md §7):
 * STRIPE_TRIAL_DAYS > 0 AND the user never trialed / subscribed anywhere (the SAME check
 * createCheckoutSession uses). The web paywall shows "Try Pro free for N days" only when
 * eligible, so the headline never promises a trial checkout won't give.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401, headers: NO_STORE });

    const configured = Number(process.env.STRIPE_TRIAL_DAYS ?? 0) || 0;
    if (configured <= 0 || !(await EntitlementService.areSubscriptionsEnabled(user.id))) {
      return NextResponse.json({ trialDays: 0, eligible: false }, { headers: NO_STORE });
    }
    const { data: profile } = await supabase.from('profiles').select('stripe_customer_id').eq('id', user.id).maybeSingle();
    const eligible = await BillingService.isWebTrialEligible(user.id, (profile?.stripe_customer_id as string | null) ?? null);
    return NextResponse.json({ trialDays: eligible ? configured : 0, eligible }, { headers: NO_STORE });
  } catch (error: any) {
    console.error('[billing/trial] failed:', error?.message);
    return NextResponse.json({ trialDays: 0, eligible: false }, { headers: NO_STORE });
  }
}
