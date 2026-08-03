import { type NextRequest, NextResponse } from 'next/server';

import { verifyCronSecret, createAdminSupabase } from '@/lib/utils/api-auth';
import { SubscriptionService } from '@/lib/services/subscription-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/subscriptions/reconcile (daily) — missed-webhook safety net.
 *
 * Any profile still premium whose subscription expired more than a day ago
 * (lifetime = NULL expiry is exempt) has drifted from RevenueCat truth — usually
 * a missed EXPIRATION webhook. Re-pull each from the RevenueCat REST API and
 * re-apply. The corrected count doubles as the drift alarm in logs.
 */
export async function GET(request: NextRequest) {
  try {
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminSupabase();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: stale, error } = await supabase
      .from('profiles')
      .select('id')
      .neq('subscription_tier', 'free')
      .not('subscription_expires_at', 'is', null)
      .lt('subscription_expires_at', cutoff)
      .limit(500);
    if (error) throw new Error(error.message);

    let corrected = 0;
    const failures: string[] = [];
    for (const row of stale ?? []) {
      try {
        await SubscriptionService.syncFromRevenueCat(row.id);
        corrected++;
      } catch (err: any) {
        failures.push(row.id);
        console.error('[reconcile] sync failed for', row.id, err?.message);
      }
    }

    if (corrected > 0) {
      console.warn(`[reconcile] corrected ${corrected} drifted subscription profiles`);
    }
    return NextResponse.json({ checked: stale?.length ?? 0, corrected, failures });
  } catch (error: any) {
    console.error('[reconcile] cron failed:', error?.message);
    return NextResponse.json({ error: 'Reconcile failed' }, { status: 500 });
  }
}
