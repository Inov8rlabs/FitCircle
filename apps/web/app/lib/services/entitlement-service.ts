import { createAdminSupabase } from '../supabase-admin';
import {
  type EntitlementsResponse,
  type FeatureEntitlement,
  type SubscriptionTier,
  BODY_COMP_FEATURE_KEYS,
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
    const [{ data: profile }, { data: gates }] = await Promise.all([
      supabase.from('profiles').select('subscription_tier').eq('id', userId).maybeSingle(),
      supabase.from('feature_gates').select('feature_key, required_tier'),
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
    for (const key of BODY_COMP_FEATURE_KEYS) {
      if (!features[key]) features[key] = { allowed: true, requiredTier: 'free' };
    }

    return { tier, features };
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
