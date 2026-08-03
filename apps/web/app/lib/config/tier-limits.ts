/**
 * Tier quota limits (MONETIZATION-PLAN.md free-vs-Pro matrix).
 *
 * These only take effect once the corresponding feature gate is flipped to
 * 'premium' (migration 077). While a gate is dark, UsageService applies the
 * LEGACY limits so behavior is byte-identical to pre-subscription FitCircle.
 *
 * Premium numbers are ABUSE CEILINGS (protect AI spend from scripted abuse),
 * not product limits — hitting one raises RateLimited, never an upgrade prompt.
 */

export const TIER_LIMITS = {
  free: {
    foodAiParsesPerDay: 5,
    fitzyMessagesPerDay: 5,
    maxActiveCreatedCircles: 2,
    historyDays: 14,
  },
  premium: {
    foodAiParsesPerDay: 100,
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
