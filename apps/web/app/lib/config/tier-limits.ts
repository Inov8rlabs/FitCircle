/**
 * Tier quota limits (MONETIZATION-PLAN.md free-vs-Pro matrix).
 *
 * These only take effect once the corresponding feature gate is flipped to
 * 'premium' (pending migration 083, the Pro launch switch). While a gate is dark, UsageService applies the
 * LEGACY limits so behavior is byte-identical to pre-subscription FitCircle.
 *
 * Premium numbers are ABUSE CEILINGS (protect AI spend from scripted abuse),
 * not product limits — hitting one raises RateLimited, never an upgrade prompt.
 *
 * The free Fitzy and food-AI numbers are REMOTE CONFIG (docs/TRIAL_FIRST_SPEC.md §6): the
 * values here are the registry's code defaults; UsageService / EntitlementService resolve the
 * live per-user value (Admin Tools rules / default) through RemoteConfigService.
 */
import { REMOTE_CONFIG_REGISTRY } from '../remote-config/registry';

export const TIER_LIMITS = {
  free: {
    /**
     * Shown as the free DAILY food-AI number to clients that predate the lifetime allowance
     * (limits.foodAiParsesPerDay). Enforcement for free users is foodAiAnalysesTotal below.
     */
    foodAiParsesPerDay: 5,
    /** Trial-first (TRIAL_FIRST_SPEC §5): 5 successful AI food analyses in TOTAL, ever (code default; remote config). */
    foodAiAnalysesTotal: REMOTE_CONFIG_REGISTRY.free_food_ai_analyses_total.default,
    // Trial-first (docs/TRIAL_FIRST_SPEC.md): Fitzy chat needs Pro or a free trial. Free users can
    // open and explore Fitzy, but the first SENT message opens the paywall (code default; remote config).
    fitzyMessagesPerDay: REMOTE_CONFIG_REGISTRY.free_fitzy_messages_per_day.default,
    maxActiveCreatedCircles: 2,
    historyDays: 14,
  },
  premium: {
    foodAiParsesPerDay: 100,
    foodAiAnalysesTotal: Number.POSITIVE_INFINITY,
    fitzyMessagesPerDay: 200,
    maxActiveCreatedCircles: Number.POSITIVE_INFINITY,
    historyDays: Number.POSITIVE_INFINITY,
  },
} as const;

/** Pre-gate behavior, preserved exactly while gates are dark. */
export const LEGACY_LIMITS = {
  foodAiParsesPerDay: 25, // former PHOTO_PARSE_DAILY_SOFT_CAP
  fitzyMessagesPerDay: Number.POSITIVE_INFINITY, // Fitzy historically uncapped
} as const;
