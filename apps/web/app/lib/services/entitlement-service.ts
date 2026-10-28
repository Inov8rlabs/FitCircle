import type { CampaignRow } from '../campaigns/model';
import { TIER_LIMITS, LEGACY_LIMITS } from '../config/tier-limits';
import { activeOffer, memberSinceFrom, MEMBER_EVENT_TYPES, proBadgeFor, type SubscriptionEventRow } from '../entitlements/pro-badge';
import { swrCache } from '../home-feed/cache';
import { isValidTimezone } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';
import {
  type EntitlementLimits,
  type EntitlementsResponse,
  type FeatureEntitlement,
  type SubscriptionTier,
  ALL_FEATURE_KEYS,
} from '../types/body-composition';

import { CampaignService } from './campaign-service';
import { FeatureFlagService } from './feature-flag-service';

/**
 * EntitlementService — server-driven feature gating (BODY_COMP_BUILD_CONTRACT §2).
 *
 * Source of truth is the `feature_gates` table (feature_key → required_tier) plus
 * `profiles.subscription_tier`. Everything ships FREE today; flipping a gate row to
 * 'premium' (service-role only, no client writes) makes:
 *  - gated API routes return 403 PREMIUM_REQUIRED via `requireFeature`
 *  - clients show their lock state via GET /api/mobile/entitlements (`allowed: false`)
 * with zero client releases and nothing hardcoded.
 *
 * Fail-open by design: a missing gate row (unseeded environment) is treated as free —
 * gating must stay invisible until Ani explicitly flips a gate.
 */
/**
 * Campaign rows for the Pro-badge offer (user-independent): per instance,
 * fresh 30 s, served stale up to 10 min while refreshing — same policy as the
 * home feed's campaign cache, so Admin Tools edits show within ~30 s.
 */
export const proOfferCampaignsCache = swrCache<CampaignRow[]>(() => CampaignService.fetchActiveRows(), {
  ttlMs: 30_000,
  maxStaleMs: 600_000,
  label: 'pro-badge campaigns',
});

export class EntitlementService {
  /**
   * Full entitlement map for a user — the payload of GET /api/mobile/entitlements.
   * `timezone` (x-client-timezone) only decides which local day a campaign offer
   * is live on; absent → UTC.
   */
  static async getEntitlements(userId: string, opts: { timezone?: string | null; now?: Date } = {}): Promise<EntitlementsResponse> {
    const supabase = createAdminSupabase();
    const now = opts.now ?? new Date();
    const timezone = isValidTimezone(opts.timezone) ? opts.timezone : 'UTC';
    const [{ data: profile }, { data: gates }, flag, trialGate, extras] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'subscription_tier, subscription_status, subscription_platform, subscription_product_id, subscription_expires_at, subscription_will_renew'
        )
        .eq('id', userId)
        .maybeSingle(),
      supabase.from('feature_gates').select('feature_key, required_tier'),
      // Master switch for the subscription surface — fail-closed on any error.
      FeatureFlagService.isFeatureEnabled('subscriptions', userId, supabase).catch(() => ({
        enabled: false,
      })),
      // Migration 112 columns, read separately so a missing column (or any
      // error) can never break the core entitlement read: unknown → no trial
      // date, gate 'none' (fail open, ONBOARDING_V2 §5.5).
      readTrialAndGate(supabase, userId),
      // Pro badge + member since (USER_TARGETS_CONTRACT §4). Never throws.
      readBadgeInputs(supabase, userId, now, timezone),
    ]);

    const tier = normalizeTier(profile?.subscription_tier);

    const features: Record<string, FeatureEntitlement> = {};
    for (const gate of gates ?? []) {
      const requiredTier = normalizeTier(gate.required_tier);
      features[gate.feature_key as string] = {
        allowed: requiredTier === 'free' || tier === 'premium',
        requiredTier,
      };
    }
    // Any known key missing from the table (unseeded env) defaults to free/allowed.
    for (const key of ALL_FEATURE_KEYS) {
      if (!features[key]) features[key] = { allowed: true, requiredTier: 'free' };
    }

    const subscriptionsEnabled = flag.enabled === true;
    const trial = trialState(tier, profile?.subscription_status, profile?.subscription_expires_at, trialGate.trialEndsAt);
    return {
      tier,
      features,
      limits: computeLimits(tier, features),
      // Additive (1.1.0): the Home crown marker + "member since" for Pro status.
      proBadge: proBadgeFor({
        offer: extras.offer,
        isPro: tier === 'premium',
        isTrial: trial.isTrial || profile?.subscription_status === 'trialing',
        subscriptionsEnabled,
        paywallLastOpenedAt: extras.paywallLastOpenedAt,
      }),
      memberSince: memberSinceFrom(extras.events, trialGate.trialStartedAt),
      subscription: {
        status: profile?.subscription_status ?? null,
        platform: profile?.subscription_platform ?? null,
        productId: profile?.subscription_product_id ?? null,
        expiresAt: profile?.subscription_expires_at ?? null,
        willRenew: profile?.subscription_will_renew ?? false,
        source: subscriptionSource(tier, profile?.subscription_platform, profile?.subscription_product_id),
        isTrial: trial.isTrial,
        trialEndsAt: trial.trialEndsAt,
      },
      subscriptionsEnabled,
      gate: trialGate.gate,
      locked: isLocked(trialGate.gate, tier, subscriptionsEnabled),
    };
  }

  /** Is the subscription surface live for this user? Fail-closed. */
  static async areSubscriptionsEnabled(userId: string): Promise<boolean> {
    try {
      const supabase = createAdminSupabase();
      const flag = await FeatureFlagService.isFeatureEnabled('subscriptions', userId, supabase);
      return flag.enabled === true;
    } catch {
      return false;
    }
  }

  /** Is a single feature allowed for this user? Missing gate row → allowed (free). */
  static async isFeatureAllowed(userId: string, featureKey: string): Promise<boolean> {
    const supabase = createAdminSupabase();
    const { data: gate } = await supabase
      .from('feature_gates')
      .select('required_tier')
      .eq('feature_key', featureKey)
      .maybeSingle();

    if (!gate || normalizeTier(gate.required_tier) === 'free') return true;

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .maybeSingle();
    return normalizeTier(profile?.subscription_tier) === 'premium';
  }

  /**
   * Server-side enforcement for gated routes: throws Error('PREMIUM_REQUIRED')
   * (mapped to 403 {error:{code:'PREMIUM_REQUIRED'}} by the route boilerplate).
   */
  static async requireFeature(userId: string, featureKey: string): Promise<void> {
    const allowed = await this.isFeatureAllowed(userId, featureKey);
    if (!allowed) throw new Error('PREMIUM_REQUIRED');
  }
}

/**
 * profiles.subscription_tier predates this feature (001 allows 'enterprise'); the API
 * contract only speaks free|premium, so any paid-looking tier collapses to 'premium'.
 * Exported so other services (e.g. StreakShieldService) share the same collapse.
 */
export function normalizeTier(raw: string | null | undefined): SubscriptionTier {
  return raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free';
}

type OnboardingGate = 'none' | 'subscription_required';

/** profiles.trial_ends_at + onboarding_gate (migration 112). Never throws. */
async function readTrialAndGate(
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string
): Promise<{ trialEndsAt: string | null; trialStartedAt: string | null; gate: OnboardingGate }> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('trial_ends_at, trial_started_at, onboarding_gate')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return { trialEndsAt: null, trialStartedAt: null, gate: 'none' };
    return {
      trialEndsAt: typeof data.trial_ends_at === 'string' ? data.trial_ends_at : null,
      trialStartedAt: typeof data.trial_started_at === 'string' ? data.trial_started_at : null,
      gate: data.onboarding_gate === 'subscription_required' ? 'subscription_required' : 'none',
    };
  } catch {
    return { trialEndsAt: null, trialStartedAt: null, gate: 'none' };
  }
}

/**
 * Inputs for proBadge + memberSince, each read fail-soft (a missing column or
 * table, or any error, yields "unknown" — never a failed entitlement read):
 *  - the active offer (Admin Tools campaign, else env),
 *  - profiles.paywall_last_opened_at (migration 115),
 *  - the user's purchase events (subscription_events).
 */
async function readBadgeInputs(
  supabase: ReturnType<typeof createAdminSupabase>,
  userId: string,
  now: Date,
  timezone: string
): Promise<{ offer: ReturnType<typeof activeOffer>; paywallLastOpenedAt: string | null; events: SubscriptionEventRow[] }> {
  const [offer, paywallLastOpenedAt, events] = await Promise.all([
    proOfferCampaignsCache
      .get()
      .catch(() => [] as CampaignRow[])
      .then((rows) => activeOffer(rows ?? [], now, timezone))
      .catch(() => null),
    (async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('paywall_last_opened_at').eq('id', userId).maybeSingle();
        return !error && typeof data?.paywall_last_opened_at === 'string' ? (data.paywall_last_opened_at) : null;
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { data, error } = await supabase
          .from('subscription_events')
          .select('type, store, environment, event_timestamp, raw')
          .eq('user_id', userId)
          .in('type', [...MEMBER_EVENT_TYPES])
          .order('event_timestamp', { ascending: true })
          .limit(50);
        return error ? [] : ((data ?? []) as SubscriptionEventRow[]);
      } catch {
        return [];
      }
    })(),
  ]);
  return { offer, paywallLastOpenedAt, events };
}

/**
 * In a free trial = status 'trialing' with Pro access. The end date is the
 * recorded trial end, else the current period end (a trial's period ends when
 * the trial does).
 */
export function trialState(
  tier: SubscriptionTier,
  status: string | null | undefined,
  expiresAt: string | null | undefined,
  trialEndsAt: string | null
): { isTrial: boolean; trialEndsAt: string | null } {
  const isTrial = tier === 'premium' && status === 'trialing';
  return { isTrial, trialEndsAt: isTrial ? (trialEndsAt ?? expiresAt ?? null) : null };
}

/**
 * Locked screen (ONBOARDING_V2 §5.5): the hard gate is set and the user has no
 * Pro. Never locks while the subscription surface is switched off — there would
 * be no way to subscribe.
 */
export function isLocked(gate: OnboardingGate, tier: SubscriptionTier, subscriptionsEnabled: boolean): boolean {
  return gate === 'subscription_required' && tier !== 'premium' && subscriptionsEnabled;
}

/**
 * Display quotas, respecting gate darkness: while a gate is dark the LEGACY
 * limit applies to everyone (identical to pre-subscription behavior); once
 * live, the tier's limit. Infinity serializes as null ("unlimited").
 */
function computeLimits(
  tier: SubscriptionTier,
  features: Record<string, FeatureEntitlement>
): EntitlementLimits {
  const live = (key: string) => features[key]?.requiredTier === 'premium';
  const asJson = (n: number) => (Number.isFinite(n) ? n : null);
  return {
    foodAiParsesPerDay: asJson(
      live('food_ai_unlimited') ? TIER_LIMITS[tier].foodAiParsesPerDay : LEGACY_LIMITS.foodAiParsesPerDay
    ),
    fitzyMessagesPerDay: asJson(
      live('fitzy_unlimited') ? TIER_LIMITS[tier].fitzyMessagesPerDay : LEGACY_LIMITS.fitzyMessagesPerDay
    ),
    maxActiveCreatedCircles: asJson(
      live('circles_unlimited') ? TIER_LIMITS[tier].maxActiveCreatedCircles : Number.POSITIVE_INFINITY
    ),
    historyDays: asJson(
      live('history_extended') ? TIER_LIMITS[tier].historyDays : Number.POSITIVE_INFINITY
    ),
  };
}

/**
 * Where premium comes from, for "Pro until … · earned by inviting friends".
 * Promotional grants pin product_id to 'referral' or 'complimentary'
 * (ComplimentaryGrantService.applyToProfile).
 */
export function subscriptionSource(
  tier: SubscriptionTier,
  platform: string | null | undefined,
  productId: string | null | undefined
): 'store' | 'referral' | 'complimentary' | null {
  if (tier !== 'premium') return null;
  if (platform === 'promotional') return productId === 'referral' ? 'referral' : 'complimentary';
  return platform ? 'store' : null;
}
