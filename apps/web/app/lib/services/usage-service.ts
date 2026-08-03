import { createAdminSupabase } from '../supabase-admin';
import { TIER_LIMITS, LEGACY_LIMITS } from '../config/tier-limits';

/**
 * UsageService — tier-aware daily quotas for metered AI features.
 *
 * Two distinct refusals, which clients treat very differently:
 *  - UpgradeRequiredError (free user at the free-tier limit, gate live):
 *    the PRIMARY paywall trigger. Routes map it to 429/402 with
 *    code 'UPGRADE_REQUIRED' + {feature, used, limit} so clients open the
 *    contextual paywall.
 *  - Error('RateLimited') (abuse ceiling, or the legacy cap while gates are
 *    dark): plain rate limit; clients keep their existing 429 handling.
 *
 * Gate-dark behavior (before migration 077): LEGACY limits apply to everyone —
 * byte-identical to pre-subscription FitCircle.
 *
 * Counting uses the proven insert-then-count pattern (nutrition_parse_log /
 * fitzy_message_log with (user_id, created_at) indexes); no stored procedures
 * per CLAUDE.md. Tolerance: two truly concurrent requests can both pass the
 * check at limit-1 — acceptable for a daily product quota.
 */

export class UpgradeRequiredError extends Error {
  constructor(
    public readonly feature: string,
    public readonly used: number,
    public readonly limit: number
  ) {
    super('UPGRADE_REQUIRED');
    this.name = 'UpgradeRequiredError';
  }
}

type Tier = 'free' | 'premium';

export class UsageService {
  /**
   * Food AI quota (photo + voice + single-item combined). Call where the old
   * PHOTO_PARSE_DAILY_SOFT_CAP check lived; counting stays on nutrition_parse_log.
   */
  static async assertFoodAiQuota(userId: string): Promise<void> {
    const [gateLive, used] = await Promise.all([
      this.isGateLive('food_ai_unlimited'),
      this.countToday('nutrition_parse_log', userId),
    ]);

    if (!gateLive) {
      if (used >= LEGACY_LIMITS.foodAiParsesPerDay) throw new Error('RateLimited');
      return;
    }

    const tier = await this.getTier(userId);
    const limit = TIER_LIMITS[tier].foodAiParsesPerDay;
    if (used >= limit) {
      if (tier === 'free') throw new UpgradeRequiredError('food_ai_unlimited', used, limit);
      throw new Error('RateLimited');
    }
  }

  /** Fitzy / nutrition-coach quota. Historically uncapped, so gate-dark is a no-op. */
  static async assertFitzyQuota(userId: string): Promise<void> {
    const gateLive = await this.isGateLive('fitzy_unlimited');
    if (!gateLive) return;

    const [tier, used] = await Promise.all([
      this.getTier(userId),
      this.countToday('fitzy_message_log', userId),
    ]);
    const limit = TIER_LIMITS[tier].fitzyMessagesPerDay;
    if (used >= limit) {
      if (tier === 'free') throw new UpgradeRequiredError('fitzy_unlimited', used, limit);
      throw new Error('RateLimited');
    }
  }

  /**
   * Record one Fitzy/coach message. Called BEFORE the model call (insert-before-
   * call closes the check/insert race in the caller's favor, not the abuser's).
   */
  static async recordFitzyMessage(userId: string): Promise<void> {
    const supabase = createAdminSupabase();
    const { error } = await supabase.from('fitzy_message_log').insert({ user_id: userId });
    if (error) console.error('[UsageService] fitzy_message_log insert failed:', error.message);
  }

  /**
   * Circle-creation cap: free users may have at most 2 active created circles
   * once the gate is live. Returns null when allowed, or the details clients
   * need for the contextual paywall.
   */
  static async checkCircleCreation(
    userId: string
  ): Promise<{ used: number; limit: number } | null> {
    const gateLive = await this.isGateLive('circles_unlimited');
    if (!gateLive) return null;

    const tier = await this.getTier(userId);
    const limit = TIER_LIMITS[tier].maxActiveCreatedCircles;
    if (!Number.isFinite(limit)) return null;

    const supabase = createAdminSupabase();
    const today = new Date().toISOString().slice(0, 10);
    const { count } = await supabase
      .from('fitcircles')
      .select('*', { count: 'exact', head: true })
      .eq('creator_id', userId)
      .eq('is_official', false)
      .gte('end_date', today);
    const used = count ?? 0;
    return used >= limit ? { used, limit } : null;
  }

  /**
   * History window for stats/insights endpoints: free = 14 days once the gate
   * is live; otherwise unlimited. Endpoints CLAMP (never 403) and mark the
   * response so clients can render the "unlock full history" footer.
   */
  static async historyWindowDays(userId: string): Promise<number> {
    const gateLive = await this.isGateLive('history_extended');
    if (!gateLive) return Number.POSITIVE_INFINITY;
    const tier = await this.getTier(userId);
    return TIER_LIMITS[tier].historyDays;
  }

  // ---------------------------------------------------------------------------

  private static async getTier(userId: string): Promise<Tier> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .maybeSingle();
    const raw = data?.subscription_tier;
    return raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free';
  }

  /** A gate is "live" once 077 flips it to premium; missing/dark rows are not. */
  private static async isGateLive(featureKey: string): Promise<boolean> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('feature_gates')
      .select('required_tier')
      .eq('feature_key', featureKey)
      .maybeSingle();
    return data?.required_tier === 'premium';
  }

  private static async countToday(
    table: 'nutrition_parse_log' | 'fitzy_message_log',
    userId: string
  ): Promise<number> {
    const supabase = createAdminSupabase();
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since.toISOString());
    return count ?? 0;
  }
}
