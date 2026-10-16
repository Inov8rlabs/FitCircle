import { type NextRequest, NextResponse } from 'next/server';

import { ComplimentaryGrantService } from '@/lib/services/complimentary-grant-service';
import { ReferralInviteService } from '@/lib/services/referral-invite-service';
import { ReferralRewardService } from '@/lib/services/referral-reward-service';
import { ReferralService } from '@/lib/services/referral-service';
import { SubscriptionService } from '@/lib/services/subscription-service';
import { verifyCronSecret, createAdminSupabase } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/referrals (hourly) — referral safety net.
 *  1. Re-evaluate pending referrals (activity-hook misses; 30-day window expiry).
 *  2. Apply banked referral days for users whose store subscription lapsed
 *     without a webhook reaching holdIfGranted.
 *  3. End expired promotional Pro on time: a referral week is a week, not
 *     "a week plus up to 30h" waiting for the daily reconcile.
 *  4. Re-send referral pushes that weren't delivered (quiet hours, no device).
 *  5. Forget plaintext emails of invites that never converted (45 days).
 */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createAdminSupabase();
  const result: Record<string, unknown> = {};

  try {
    result.evaluate = await ReferralService.evaluatePending();
  } catch (err: any) {
    console.error('[cron/referrals] evaluate failed:', err?.message);
    result.evaluate = { error: err?.message };
  }

  try {
    const { data: banked } = await supabase
      .from('referral_rewards')
      .select('user_id')
      .eq('status', 'banked')
      .limit(1000);
    const users = Array.from(new Set((banked ?? []).map((r: { user_id: string }) => r.user_id)));
    let applied = 0;
    for (const userId of users) {
      try {
        const out = await ReferralRewardService.applyBanked(userId);
        if (out.appliedDays > 0 || out.lifetime) applied++;
      } catch (err: any) {
        console.error('[cron/referrals] applyBanked failed:', userId, err?.message);
      }
    }
    result.banked = { users: users.length, applied };
  } catch (err: any) {
    result.banked = { error: err?.message };
  }

  try {
    const { data: expired } = await supabase
      .from('profiles')
      .select('id')
      .eq('subscription_platform', 'promotional')
      .neq('subscription_tier', 'free')
      .not('subscription_expires_at', 'is', null)
      .lt('subscription_expires_at', new Date().toISOString())
      .limit(500);
    let ended = 0;
    for (const row of (expired ?? []) as Array<{ id: string }>) {
      try {
        try {
          // A store purchase we never heard about wins; otherwise hold/downgrade.
          await SubscriptionService.syncFromRevenueCat(row.id);
        } catch {
          if (!(await ComplimentaryGrantService.holdIfGranted(row.id))) {
            await supabase
              .from('profiles')
              .update({
                subscription_tier: 'free',
                subscription_status: 'cancelled',
                subscription_platform: null,
                subscription_product_id: null,
                subscription_will_renew: false,
                subscription_synced_at: new Date().toISOString(),
              })
              .eq('id', row.id);
          }
        }
        ended++;
      } catch (err: any) {
        console.error('[cron/referrals] expiry sync failed:', row.id, err?.message);
      }
    }
    result.expired = { checked: expired?.length ?? 0, ended };
  } catch (err: any) {
    result.expired = { error: err?.message };
  }

  try {
    result.pushRetries = await ReferralService.retryUndeliveredPushes();
  } catch (err: any) {
    result.pushRetries = { error: err?.message };
  }

  try {
    result.purgedEmails = await ReferralInviteService.purgeStale();
  } catch (err: any) {
    result.purgedEmails = { error: err?.message };
  }

  return NextResponse.json(result);
}
