/**
 * The four v1 system promos (ACTIVATION_JOURNEY_SPEC §3), defined in code.
 * Ops pause them with PROMOS_DISABLED_KEYS; copy changes ship with the server.
 *
 * All copy is honest product copy: no invented stats or social proof, and
 * pro_value only claims what Pro really unlocks right now (creatives backed by
 * a feature gate are only offered while that gate is live — see
 * EntitlementService / feature_gates; the Fitzy weekly plan + memory are Pro
 * by tier, FITZY_V2_SPEC).
 */
import { TIER_LIMITS } from '../config/tier-limits';
import { SLOT_DEFS, slotForMinutes, type MealSlot } from '../journey/meal-slots';

import type { CreativeOption, PromoDefinition, PromoMatchInput } from './engine';
import type { PromoAction, PromoTheme } from './types';

/**
 * Feed score anchors (DefaultRanker: header 990, campaign 970, hydration 960,
 * referral 950, pro_upsell 940, fitzy_focus 900). With at most 2 promo-category
 * cards per promo@1 feed (G7), ranking decides who stays: the activation
 * promos outrank the evergreen referral card (it returns once they're logged,
 * dismissed or capped). Rules can still boost/move `promo:<key>` or `referral`.
 */
export const PROMO_SCORES = {
  first_meal: 985, // directly under the header (position ≤ 2, guardrail-pinned)
  log_meal_now: 965, // just under a campaign card, above hydration
  pro_value: 955, // above referral (paywall reach is an activation goal), where pro_upsell sat otherwise
  meet_fitzy: 905, // just above the Fitzy focus card
} as const;

/** Hours after sign-up before pro_value may show (never before the user has seen value). */
export const PRO_VALUE_MIN_HOURS_SINCE_SIGNUP = 18;

export const PAYWALL_PLACEMENT_FEED = 'feed_pro_value';

const theme = (colors: string[]): PromoTheme => ({ background: { kind: 'gradient', colors }, foreground: 'light' });

const THEMES = {
  firstMeal: theme(['#312E81', '#6D28D9', '#BE185D']),
  logMeal: theme(['#064E3B', '#047857', '#0E7490']),
  pro: theme(['#1E1B4B', '#4338CA', '#7C3AED']),
  fitzy: theme(['#0C4A6E', '#0369A1', '#6D28D9']),
};

const logMealAction = (meal?: MealSlot): PromoAction => ({
  type: 'open_screen',
  params: { screen: 'log_meal', ...(meal ? { meal } : {}) },
  fallback: [{ type: 'open_screen', params: { screen: 'food_log' } }],
});

const hoursSince = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (now.getTime() - t) / 3_600_000;
};

// ---------------------------------------------------------------------------- first_meal

export const firstMeal: PromoDefinition = {
  key: 'first_meal',
  kind: 'utility',
  score: PROMO_SCORES.first_meal,
  caps: { cooldownHoursAfterDismiss: 24, hideAfterConversion: true },
  // Utility: worth showing even when the state read failed.
  requiresState: false,
  audience: ({ journey }) => (journey.hasLoggedMeal === false ? null : journey.hasLoggedMeal === null ? 'meals_unknown' : 'has_meal'),
  creatives: () => [
    {
      id: 'first_meal_v1',
      weight: 100,
      layout: 'hero',
      theme: THEMES.firstMeal,
      emoji: '📸',
      eyebrow: 'Your first step',
      title: 'Snap your first meal',
      body: "Take a photo of what you're eating and get calories and macros in seconds. Or just describe it.",
      primary: { label: 'Snap a meal', action: logMealAction() },
      dismissible: true,
    },
  ],
};

// ---------------------------------------------------------------------------- log_meal_now

export const LOG_MEAL_COPY: Record<MealSlot, { title: string; body: string; emoji: string; label: string }> = {
  breakfast: { title: 'Log your breakfast', body: 'Snap it and see calories and macros in seconds.', emoji: '🍳', label: 'Log breakfast' },
  lunch: { title: 'Log your lunch', body: 'A quick photo is all it takes.', emoji: '🥗', label: 'Log lunch' },
  snack: { title: 'Log your snack', body: "Snap it so today's picture is complete.", emoji: '🍎', label: 'Log snack' },
  dinner: { title: 'Log your dinner', body: 'Snap dinner to round out your day.', emoji: '🍽️', label: 'Log dinner' },
};

/** The open slot right now (local window, not logged, reminder pref on), or null. */
export function openSlot({ journey }: PromoMatchInput): MealSlot | null {
  const slot = slotForMinutes(journey.localMinutes);
  if (!slot || !journey.loggedSlotsToday || journey.loggedSlotsToday.includes(slot)) return null;
  return journey.mealReminderPrefs[slot] ? slot : null;
}

export const logMealNow: PromoDefinition = {
  key: 'log_meal_now',
  kind: 'promo',
  score: PROMO_SCORES.log_meal_now,
  caps: { cooldownHoursAfterDismiss: 2 },
  requiresState: true,
  audience: (input) => {
    const { journey } = input;
    if (journey.hasLoggedMeal !== true) return journey.hasLoggedMeal === null ? 'meals_unknown' : 'no_meal_yet';
    if (journey.loggedSlotsToday === null) return 'slots_unknown';
    const slot = slotForMinutes(journey.localMinutes);
    if (!slot) return 'outside_slots';
    if (journey.loggedSlotsToday.includes(slot)) return 'slot_logged';
    if (!journey.mealReminderPrefs[slot]) return 'slot_off';
    return null;
  },
  creatives: (input) => {
    const slot = openSlot(input);
    if (!slot) return [];
    const c = LOG_MEAL_COPY[slot];
    return [
      {
        id: `log_meal_now_${slot}`,
        weight: 100,
        layout: 'banner',
        theme: THEMES.logMeal,
        emoji: c.emoji,
        title: c.title,
        body: c.body,
        primary: { label: c.label, action: logMealAction(slot) },
        dismissible: true,
      },
    ];
  },
};

// ---------------------------------------------------------------------------- pro_value

const paywallAction: PromoAction = { type: 'paywall', params: { placement: PAYWALL_PLACEMENT_FEED } };

/**
 * A/B creatives. `requires` = feature gates that must be live (premium) for
 * the claim to be true; a creative whose gate is dark is not offered.
 */
export function proValueCreatives(live: Set<string> | null): CreativeOption[] {
  const has = (k: string) => live?.has(k) === true;
  const freeScans = TIER_LIMITS.free.foodAiParsesPerDay;
  const historyBody = has('ads_removed')
    ? 'Pro keeps your full history and trends, and removes ads.'
    : `Pro keeps your full history and trends, not just the last ${TIER_LIMITS.free.historyDays} days.`;
  return [
    {
      id: 'pro_value_scans',
      weight: 34,
      available: has('food_ai_unlimited'),
      layout: 'banner',
      theme: THEMES.pro,
      emoji: '📸',
      eyebrow: 'FitCircle Pro',
      title: "See exactly what's in every bite",
      body: `Free includes ${freeScans} AI meal scans a day. Pro makes them unlimited, so every meal counts.`,
      primary: { label: 'See Pro', action: paywallAction },
      dismissible: true,
    },
    {
      // Weekly plan + memory are Pro by tier (FITZY_V2_SPEC), independent of feature_gates.
      id: 'pro_value_coach',
      weight: 33,
      layout: 'banner',
      theme: THEMES.pro,
      emoji: '🗓️',
      eyebrow: 'FitCircle Pro',
      title: 'A coach that plans your week',
      body: 'With Pro, Fitzy builds a weekly plan around your goals and remembers what works for you.',
      primary: { label: 'See Pro', action: paywallAction },
      dismissible: true,
    },
    {
      id: 'pro_value_history',
      weight: 33,
      available: has('history_extended'),
      layout: 'banner',
      theme: THEMES.pro,
      emoji: '📈',
      eyebrow: 'FitCircle Pro',
      title: 'Your whole journey, in one place',
      body: historyBody,
      primary: { label: 'See Pro', action: paywallAction },
      dismissible: true,
    },
  ];
}

export const proValue: PromoDefinition = {
  key: 'pro_value',
  kind: 'promo',
  score: PROMO_SCORES.pro_value,
  caps: { perWeek: 3, cooldownHoursAfterDismiss: 48, hideAfterConversion: true },
  requiresState: true,
  audience: ({ ctx, journey }) => {
    if (ctx.isPro !== false) return ctx.isPro === null ? 'tier_unknown' : 'already_pro';
    if (ctx.subscriptionsEnabled !== true) return 'subscriptions_off';
    if (journey.hasLoggedMeal !== true) return journey.hasLoggedMeal === null ? 'meals_unknown' : 'no_meal_yet';
    const h = hoursSince(journey.signupAt, ctx.now);
    if (h === null) return 'signup_unknown';
    if (h < PRO_VALUE_MIN_HOURS_SINCE_SIGNUP) return 'too_new';
    return null;
  },
  creatives: ({ liveProFeatures }) => proValueCreatives(liveProFeatures),
};

// ---------------------------------------------------------------------------- meet_fitzy

export const FITZY_PROMPT_MAX = 200;
const MEAL_TITLE_MAX = 120;

/** The chat prefill seeded from the user's last meal (plain text, ≤ 200). */
export function fitzyPromptFor(lastMeal: PromoMatchInput['journey']['lastMeal']): string {
  const title = (lastMeal?.title ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>[\]`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const meal = lastMeal?.mealType && lastMeal.mealType in SLOT_DEFS ? lastMeal.mealType : 'meal';
  if (!title) return 'What do you think of my last meal?';
  const clipped = [...title].length > MEAL_TITLE_MAX ? `${[...title].slice(0, MEAL_TITLE_MAX - 1).join('').trimEnd()}…` : title;
  return `What do you think of my ${meal}: ${clipped}?`.slice(0, FITZY_PROMPT_MAX);
}

export const meetFitzy: PromoDefinition = {
  key: 'meet_fitzy',
  kind: 'promo',
  score: PROMO_SCORES.meet_fitzy,
  caps: { cooldownHoursAfterDismiss: 72, hideAfterConversion: true },
  requiresState: true,
  audience: ({ journey }) => {
    if (journey.hasLoggedMeal !== true) return journey.hasLoggedMeal === null ? 'meals_unknown' : 'no_meal_yet';
    if (journey.fitzyOpenedAt === undefined) return 'fitzy_unknown';
    if (journey.fitzyOpenedAt !== null) return 'fitzy_opened';
    return null;
  },
  creatives: ({ journey }) => [
    {
      id: 'meet_fitzy_v1',
      weight: 100,
      layout: 'banner',
      theme: THEMES.fitzy,
      emoji: '💬',
      title: 'Meet Fitzy, your coach',
      body: 'Ask anything about your meals. Fitzy can tell you what is working and what to try next.',
      primary: {
        label: 'Chat with Fitzy',
        action: { type: 'open_screen', params: { screen: 'fitzy', prompt: fitzyPromptFor(journey.lastMeal) }, fallback: [{ type: 'open_screen', params: { screen: 'fitzy' } }] },
      },
      dismissible: true,
    },
  ],
};

/** In evaluation order (ranking is by score, not this order). */
export const SYSTEM_PROMOS: readonly PromoDefinition[] = [firstMeal, logMealNow, proValue, meetFitzy];

export const SYSTEM_PROMO_KEYS = SYSTEM_PROMOS.map((p) => p.key);
