import { createAdminSupabase } from '../supabase-admin';
import { TIER_LIMITS, LEGACY_LIMITS } from '../config/tier-limits';
import { FeatureFlagService } from './feature-flag-service';
import {
  type EntitlementLimits,
  type EntitlementsResponse,
  type FeatureEntitlement,
  type SubscriptionTier,
  ALL_FEATURE_KEYS,
} from '../types/body-composition';

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
export class EntitlementService {
  /** Full entitlement map for a user — the payload of GET /api/mobile/entitlements. */
  static async getEntitlements(userId: string): Promise<EntitlementsResponse> {
    const supabase = createAdminSupabase();
    const [{ data: profile }, { data: gates }, flag] = await Promise.all([
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

    return {
      tier,
      features,
      limits: computeLimits(tier, features),
      subscription: {
        status: profile?.subscription_status ?? null,
        platform: profile?.subscription_platform ?? null,
        productId: profile?.subscription_product_id ?? null,
        expiresAt: profile?.subscription_expires_at ?? null,
        willRenew: profile?.subscription_will_renew ?? false,
      },
      subscriptionsEnabled: flag.enabled === true,
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
 */
function normalizeTier(raw: string | null | undefined): SubscriptionTier {
  return raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free';
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
