/**
 * Which Pro lifecycle state a user is in right now. Pure.
 *
 *  pro_expiring    free Pro (referral weeks or a complimentary grant) whose
 *                  effective end — the LATEST expiry among the active grants,
 *                  so renewed referral days and an admin grant on top both
 *                  count — is within `hoursBefore`. A never-expiring active
 *                  grant (admin "until revoked", referral lifetime) = lifetime.
 *  pro_expired     the latest non-revoked grant ended within `daysAfter`, no
 *                  grant is active, and the profile has been downgraded (free).
 *                  Between the expiry and the hourly downgrade the user still
 *                  has Pro: 'awaiting_downgrade', no prompt.
 *  trial_expiring  an App Store / Play / web trial with renewal turned OFF,
 *                  ending within `hoursBefore` (renewing trials get the
 *                  existing trial_ending_reminder only).
 *
 * Excluded: internal / test accounts (ads/test-users.ts rules), anyone who has
 * paid before, live store subscribers (a store purchase always wins), lifetime.
 */
import { classifyTestUser } from '../ads/test-users';

import type { GrantRow, LifecycleFacts, LifecycleResult, LifecycleSkip, ProLifecycleConfig, ProLifecycleState, ProSource } from './types';

const HOUR = 3_600_000;
const DAY = 86_400_000;

const isReferralGrant = (g: Pick<GrantRow, 'granted_by'>) => g.granted_by === 'referral-program' || g.granted_by === 'referral-lifetime';
const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};
const premiumTier = (tier: string | null | undefined) => tier === 'premium' || tier === 'enterprise';
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Store (App Store / Play / Stripe) subscription that is live right now. */
export function hasLiveStoreSubscription(p: LifecycleFacts['profile'], now: Date): boolean {
  if (!premiumTier(p.subscription_tier)) return false;
  if (!p.subscription_platform || p.subscription_platform === 'promotional') return false;
  const exp = ms(p.subscription_expires_at);
  return exp === null || exp > now.getTime();
}

const none = (reason: LifecycleSkip, extra: Partial<LifecycleResult> = {}): LifecycleResult => ({
  state: null,
  reason,
  endsAt: null,
  startedAt: null,
  source: null,
  trialAvailable: false,
  periodDays: null,
  ...extra,
});

export function computeLifecycleState(facts: LifecycleFacts, now: Date, config: ProLifecycleConfig, env: Record<string, string | undefined> = process.env): LifecycleResult {
  const p = facts.profile;
  const t = now.getTime();
  if (classifyTestUser({ email: p.email ?? null, isAdmin: p.is_admin ?? null }, env)) return none('internal_account');
  const trialAvailable = !facts.hadTrial && !facts.hasPurchased && !p.trial_started_at;

  // Store trial (card only).
  if (hasLiveStoreSubscription(p, now) && p.subscription_status === 'trialing') {
    const end = ms(p.trial_ends_at) ?? ms(p.subscription_expires_at);
    if (end === null || end <= t) return none('store_subscription');
    if (p.subscription_will_renew !== false) return none('trial_renews', { endsAt: new Date(end).toISOString(), source: 'store_trial' });
    if (end - t > config.states.trial_expiring.hoursBefore * HOUR) return none('not_ending_soon', { endsAt: new Date(end).toISOString(), source: 'store_trial' });
    const start = ms(p.trial_started_at);
    return {
      state: 'trial_expiring',
      reason: null,
      endsAt: new Date(end).toISOString(),
      startedAt: start !== null ? new Date(start).toISOString() : null,
      source: 'store_trial',
      trialAvailable: false,
      periodDays: start !== null ? round1((end - start) / DAY) : null,
    };
  }

  if (facts.hasPurchased) return none('purchased');
  if (hasLiveStoreSubscription(p, now)) return none('store_subscription');

  const live = facts.grants.filter((g) => !g.revoked_at);
  const active = live.filter((g) => g.expires_at === null || (ms(g.expires_at) ?? 0) > t);
  if (active.some((g) => g.expires_at === null)) return none('lifetime');

  if (active.length > 0) {
    const best = active.reduce((a, b) => ((ms(b.expires_at) ?? 0) > (ms(a.expires_at) ?? 0) ? b : a));
    const end = ms(best.expires_at)!;
    const result = grantResult('pro_expiring', best, end, trialAvailable);
    if (end - t > config.states.pro_expiring.hoursBefore * HOUR) return { ...result, state: null, reason: 'not_ending_soon' };
    return result;
  }

  const ended = live.filter((g) => (ms(g.expires_at) ?? Infinity) <= t);
  if (ended.length === 0) return none(facts.grants.length > 0 ? 'revoked' : 'no_grant');
  const last = ended.reduce((a, b) => ((ms(b.expires_at) ?? 0) > (ms(a.expires_at) ?? 0) ? b : a));
  const end = ms(last.expires_at)!;
  const result = grantResult('pro_expired', last, end, trialAvailable);
  if (t - end > config.states.pro_expired.daysAfter * DAY) return { ...result, state: null, reason: 'ended_too_long_ago' };
  if (premiumTier(p.subscription_tier)) return { ...result, state: null, reason: 'awaiting_downgrade' };
  return result;
}

function grantResult(state: ProLifecycleState, g: GrantRow, end: number, trialAvailable: boolean): LifecycleResult {
  const start = ms(g.created_at);
  const source: ProSource = isReferralGrant(g) ? 'referral' : 'complimentary';
  return {
    state,
    reason: null,
    endsAt: new Date(end).toISOString(),
    startedAt: start !== null ? new Date(start).toISOString() : null,
    source,
    trialAvailable,
    periodDays: start !== null ? round1((end - start) / DAY) : null,
  };
}

/**
 * subscription_events rows → (hasPurchased, hadTrial). Real = not RevenueCat
 * TEST and not SANDBOX. A TRIAL-period INITIAL_PURCHASE is a trial, not a
 * payment; a RENEWAL / NON_RENEWING_PURCHASE / paid INITIAL_PURCHASE is.
 */
export function purchaseHistory(
  events: ReadonlyArray<{ type?: string | null; environment?: string | null; raw?: unknown }>,
  profile: Pick<LifecycleFacts['profile'], 'trial_started_at' | 'trial_converted_at'>
): { hasPurchased: boolean; hadTrial: boolean } {
  let hasPurchased = !!profile.trial_converted_at;
  let hadTrial = !!profile.trial_started_at;
  for (const e of events) {
    if (e.type === 'TEST' || (e.environment ?? '').toUpperCase() === 'SANDBOX') continue;
    const raw = (e.raw ?? {}) as { event?: { period_type?: string }; period_type?: string };
    const period = String(raw.event?.period_type ?? raw.period_type ?? '').toUpperCase();
    if (e.type === 'INITIAL_PURCHASE') {
      if (period === 'TRIAL') hadTrial = true;
      else hasPurchased = true;
    } else if (e.type === 'RENEWAL' || e.type === 'NON_RENEWING_PURCHASE' || e.type === 'PRODUCT_CHANGE') {
      hasPurchased = true;
    }
  }
  return { hasPurchased, hadTrial };
}
