import { type NextRequest, NextResponse } from 'next/server';

import { createServerSupabase } from '@/lib/supabase-server';
import { BillingService } from '@/lib/services/billing-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/portal — self-serve subscription management.
 * Stripe subscribers get a Billing Portal URL; store subscribers get platform
 * info so the UI can say "Manage in the App Store / Google Play".
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_platform, stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (profile?.subscription_platform !== 'stripe' || !profile?.stripe_customer_id) {
      return NextResponse.json({
        url: null,
        platform: profile?.subscription_platform ?? null,
      });
    }

    const origin = request.headers.get('origin') ?? new URL(request.url).origin;
    const { url } = await BillingService.createPortalSession(profile.stripe_customer_id, origin);
    return NextResponse.json({ url, platform: 'stripe' });
  } catch (error: any) {
    console.error('[billing/portal] failed:', error?.message);
    return NextResponse.json({ error: 'Could not open billing portal' }, { status: 500 });
  }
}
