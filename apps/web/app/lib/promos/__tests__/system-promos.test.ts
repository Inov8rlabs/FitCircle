/**
 * The four system promos (ACTIVATION_JOURNEY_SPEC §3): audiences, copy
 * validity on every creative, time-aware log_meal_now, honest pro_value,
 * meet_fitzy prompt seeding.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTION_TYPES,
  LOG_MEAL_COPY,
  PRO_VALUE_MIN_HOURS_SINCE_SIGNUP,
  SYSTEM_PROMOS,
  buildPromoProps,
  buildJourneyContext,
  firstMeal,
  fitzyPromptFor,
  logMealNow,
  meetFitzy,
  parseClientActions,
  parsePromoClient,
  proValue,
  proValueCreatives,
  fitzyRecommendations,
  fitzyRecommendationsCreatives,
  fitzyRecommendationsReadyFrom,
  PROMO_SCORES,
  promosConfig,
  selectPromos,
  type JourneyContext,
  type PromoMatchInput,
} from '..';
import { makeCtx } from '../../home-feed/__tests__/helpers';
import { UTILITY_PROMO_IDS } from '../../home-feed/catalog';
import { DEFAULT_MEAL_REMINDER_PREFS } from '../../journey/meal-slots';

const ALL = parseClientActions(ACTION_TYPES.map((t) => `${t}@1`).join(','));
const CLIENT = parsePromoClient({ cardsSupportPromo: true, actions: ACTION_TYPES.map((t) => `${t}@1`).join(','), promoLayouts: 'hero,banner,compact' });
const NOW = new Date('2026-10-26T19:00:00Z'); // 12:00 in Los Angeles (PDT)

const journey = (over: Partial<JourneyContext> = {}): JourneyContext => ({
  hasLoggedMeal: true,
  loggedSlotsToday: [],
  lastMeal: { title: 'Chicken salad', mealType: 'lunch' },
  signupAt: '2026-10-01T00:00:00Z',
  fitzyOpenedAt: null,
  mealReminderPrefs: { ...DEFAULT_MEAL_REMINDER_PREFS },
  localMinutes: 12 * 60,
  ...over,
});
const input = (j: Partial<JourneyContext> = {}, ctx = {}, live: Set<string> | null = new Set(['food_ai_unlimited', 'history_extended', 'ads_removed'])): PromoMatchInput => ({
  ctx: makeCtx({ now: NOW, ...ctx }),
  journey: journey(j),
  liveProFeatures: live,
});

describe('catalog wiring', () => {
  it('keys are unique and utility promos match the guardrail list', () => {
    expect(new Set(SYSTEM_PROMOS.map((p) => p.key)).size).toBe(SYSTEM_PROMOS.length);
    expect(SYSTEM_PROMOS.filter((p) => p.kind === 'utility').map((p) => `promo:${p.key}`)).toEqual([...UTILITY_PROMO_IDS]);
  });

  it('every creative of every system promo is valid wire props (lengths, contrast, actions) for a full client', () => {
    const variants: PromoMatchInput[] = [
      input({ hasLoggedMeal: false }),
      ...(['breakfast', 'lunch', 'snack', 'dinner'] as const).map((s) =>
        input({ localMinutes: { breakfast: 8 * 60, lunch: 12 * 60, snack: 16 * 60, dinner: 19 * 60 }[s], mealReminderPrefs: { breakfast: true, lunch: true, snack: true, dinner: true } })
      ),
      input({ lastMeal: { title: 'x'.repeat(400), mealType: 'dinner' } }),
      input({}, {}, new Set()),
    ];
    let checked = 0;
    for (const def of SYSTEM_PROMOS) {
      for (const v of variants) {
        for (const c of def.creatives(v)) {
          expect(buildPromoProps(def.key, c, ALL), `${def.key}/${c.id}`).not.toBeNull();
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(15);
  });
});

describe('first_meal', () => {
  it('only for users with no meal ever (unknown → hidden)', () => {
    expect(firstMeal.audience(input({ hasLoggedMeal: false }))).toBeNull();
    expect(firstMeal.audience(input({ hasLoggedMeal: true }))).toBe('has_meal');
    expect(firstMeal.audience(input({ hasLoggedMeal: null }))).toBe('meals_unknown');
  });
  it('hero, gradient + 📸, opens the meal logger (falls back to the food log)', () => {
    const [c] = firstMeal.creatives(input({ hasLoggedMeal: false }));
    expect(c).toMatchObject({ layout: 'hero', emoji: '📸', title: 'Snap your first meal' });
    expect(c.image).toBeUndefined();
    expect(buildPromoProps('first_meal', c, parseClientActions('open_screen@1'))!.primary.action).toEqual({ type: 'open_screen', params: { screen: 'log_meal' } });
    expect(firstMeal.caps).toEqual({ cooldownHoursAfterDismiss: 24, hideAfterConversion: true });
  });
});

describe('log_meal_now (time-aware)', () => {
  it('shows during the open slot with slot-specific copy and preselects the meal', () => {
    for (const [slot, minutes] of [['breakfast', 7 * 60], ['lunch', 13 * 60], ['dinner', 18 * 60 + 30]] as const) {
      const i = input({ localMinutes: minutes });
      expect(logMealNow.audience(i), slot).toBeNull();
      const [c] = logMealNow.creatives(i);
      expect(c.id).toBe(`log_meal_now_${slot}`);
      expect(c.title).toBe(LOG_MEAL_COPY[slot].title);
      expect(c.primary.action.params).toEqual({ screen: 'log_meal', meal: slot });
    }
  });
  it('hidden when the slot is logged, outside every window, or before the first meal', () => {
    expect(logMealNow.audience(input({ loggedSlotsToday: ['lunch'] }))).toBe('slot_logged');
    expect(logMealNow.audience(input({ localMinutes: 23 * 60 }))).toBe('outside_slots');
    expect(logMealNow.audience(input({ hasLoggedMeal: false }))).toBe('no_meal_yet');
    expect(logMealNow.audience(input({ loggedSlotsToday: null }))).toBe('slots_unknown');
    // The push toggles don't gate the card: snack (push off by default) still shows 15:00–16:59,
    // and turning off the lunch push keeps the lunch card.
    expect(logMealNow.audience(input({ localMinutes: 16 * 60 }))).toBeNull();
    expect(logMealNow.creatives(input({ localMinutes: 16 * 60 }))[0].id).toBe('log_meal_now_snack');
    expect(logMealNow.audience(input({ localMinutes: 13 * 60, mealReminderPrefs: { ...DEFAULT_MEAL_REMINDER_PREFS, lunch: false } }))).toBeNull();
  });
  it('a lunch logged as "snack" at 12:40 counts as lunch (entry time in window)', () => {
    const j = buildJourneyContext(
      { id: 'u', created_at: '2026-10-01T00:00:00Z', fitzy_opened_at: null, preferences: {} },
      { lastMeal: { title: 'Wrap', meal_type: 'snack', logged_at: '2026-10-26T19:40:00Z' }, recentEntries: [{ entry_type: 'food', entry_date: '2026-10-26', meal_type: 'snack', logged_at: '2026-10-26T19:40:00Z' }] },
      { now: NOW, timezone: 'America/Los_Angeles', localDate: '2026-10-26' }
    );
    expect(j.loggedSlotsToday!.sort()).toEqual(['lunch', 'snack']);
    expect(logMealNow.audience({ ...input(), journey: j })).toBe('slot_logged');
  });
  it('never alongside first_meal (they need opposite meal histories)', () => {
    const none = input({ hasLoggedMeal: false });
    expect(firstMeal.audience(none)).toBeNull();
    expect(logMealNow.audience(none)).not.toBeNull();
  });
});

describe('pro_value', () => {
  const day = 3_600_000;
  it('free, subscriptions on, ≥ 1 meal, ≥ 18 h since sign-up', () => {
    expect(proValue.audience(input())).toBeNull();
    expect(proValue.audience(input({}, { isPro: true }))).toBe('already_pro');
    expect(proValue.audience(input({}, { isPro: null }))).toBe('tier_unknown');
    expect(proValue.audience(input({}, { subscriptionsEnabled: false }))).toBe('subscriptions_off');
    expect(proValue.audience(input({ hasLoggedMeal: false }))).toBe('no_meal_yet');
    const at = (h: number) => new Date(NOW.getTime() - h * day).toISOString();
    expect(proValue.audience(input({ signupAt: at(PRO_VALUE_MIN_HOURS_SINCE_SIGNUP - 1) }))).toBe('too_new');
    expect(proValue.audience(input({ signupAt: at(PRO_VALUE_MIN_HOURS_SINCE_SIGNUP + 1) }))).toBeNull();
    expect(proValue.caps).toEqual({ perWeek: 3, cooldownHoursAfterDismiss: 48, hideAfterConversion: true });
  });
  it('2–3 A/B creatives; claims backed by a feature gate only while that gate is live', () => {
    const live = proValueCreatives(new Set(['food_ai_unlimited', 'history_extended', 'ads_removed']));
    expect(live.filter((c) => c.available !== false).map((c) => c.id)).toEqual(['pro_value_scans', 'pro_value_coach', 'pro_value_history']);
    expect(live.find((c) => c.id === 'pro_value_history')!.body).toMatch(/removes ads/);
    const dark = proValueCreatives(new Set());
    expect(dark.filter((c) => c.available !== false).map((c) => c.id)).toEqual(['pro_value_coach']);
    const unknown = proValueCreatives(null);
    expect(unknown.filter((c) => c.available !== false).map((c) => c.id)).toEqual(['pro_value_coach']);
    const noAds = proValueCreatives(new Set(['history_extended']));
    expect(noAds.find((c) => c.id === 'pro_value_history')!.body).not.toMatch(/ads/);
    for (const c of live) {
      expect(c.primary.action).toEqual({ type: 'paywall', params: { placement: 'feed_pro_value' } });
      expect(`${c.title} ${c.body}`).not.toMatch(/\d+\s*(k|,000)|users|people|members love|#1|best/i); // no invented social proof
    }
  });
  it('no stale free-scan number (the allowance is lifetime + remote config)', () => {
    expect(proValueCreatives(new Set(['food_ai_unlimited']))[0].body).not.toMatch(/\d/);
  });
  it('dropped entirely for a client without paywall@1', () => {
    const client = parsePromoClient({ cardsSupportPromo: true, actions: 'open_screen@1', promoLayouts: 'banner' });
    const r = selectPromos({ definitions: [proValue], ctx: makeCtx({ now: NOW }), journey: journey(), state: new Map(), liveProFeatures: new Set(), client, config: promosConfig({ PROMOS_ENABLED: 'true' }) });
    expect(r.candidates).toHaveLength(0);
  });
});

describe('meet_fitzy', () => {
  it('activated users who never opened Fitzy (unknown column → hidden)', () => {
    expect(meetFitzy.audience(input())).toBeNull();
    expect(meetFitzy.audience(input({ fitzyOpenedAt: '2026-10-20T00:00:00Z' }))).toBe('fitzy_opened');
    expect(meetFitzy.audience(input({ fitzyOpenedAt: undefined }))).toBe('fitzy_unknown');
    expect(meetFitzy.audience(input({ hasLoggedMeal: false }))).toBe('no_meal_yet');
  });
  it('Pro: opens Fitzy with a prompt seeded from the last meal (sanitised, ≤ 200)', () => {
    const [c] = meetFitzy.creatives(input({}, { isPro: true }));
    expect(c.primary.action.params).toEqual({ screen: 'fitzy', prompt: 'What do you think of my lunch: Chicken salad?' });
    expect(fitzyPromptFor({ title: '  <b>Pad\nthai</b> [x](y) ', mealType: 'other' })).toBe('What do you think of my meal: b Pad thai /b x (y)?');
    expect(fitzyPromptFor(null)).toBe('What do you think of my last meal?');
    expect([...fitzyPromptFor({ title: 'z'.repeat(500), mealType: 'dinner' })].length).toBeLessThanOrEqual(200);
  });
  it('Pro: falls back to plain open_screen fitzy if the prompt were invalid', () => {
    const [c] = meetFitzy.creatives(input({}, { isPro: true }));
    expect(c.primary.action.fallback).toEqual([{ type: 'open_screen', params: { screen: 'fitzy' } }]);
  });

  it('free (TRIAL_FIRST_SPEC §3.1): no free-chat promise and no prefilled question that would hit the paywall', () => {
    const [trial] = meetFitzy.creatives(input({ trialEligible: true }));
    expect(trial).toMatchObject({
      id: 'meet_fitzy_free_trial',
      title: 'Meet Fitzy, your AI coach',
      body: 'Get a free daily focus from Fitzy. Chatting with Fitzy is part of Pro, with a free 7-day trial.',
      primary: { label: 'Meet Fitzy', action: { type: 'open_screen', params: { screen: 'fitzy' } } },
    });
    const [noTrial] = meetFitzy.creatives(input({ trialEligible: false }));
    expect(noTrial).toMatchObject({ id: 'meet_fitzy_free', body: 'Get a free daily focus from Fitzy. Chatting with Fitzy is part of Pro.' });
    expect(`${noTrial.title} ${noTrial.body} ${noTrial.primary.label}`).not.toMatch(/chat with fitzy|ask anything/i);
  });
});

describe('selection across all four for one user', () => {
  it('a brand-new user only gets first_meal; an activated free user gets log_meal_now + pro_value + meet_fitzy', () => {
    const cfg = promosConfig({ PROMOS_ENABLED: 'true' });
    const base = { definitions: SYSTEM_PROMOS, ctx: makeCtx({ now: NOW }), state: new Map(), liveProFeatures: new Set(['food_ai_unlimited']), client: CLIENT, config: cfg };
    expect(selectPromos({ ...base, journey: journey({ hasLoggedMeal: false, lastMeal: null }) }).candidates.map((c) => c.promoKey)).toEqual(['first_meal']);
    expect(selectPromos({ ...base, journey: journey() }).candidates.map((c) => c.promoKey)).toEqual(['log_meal_now', 'pro_value', 'meet_fitzy']);
  });
});

describe('fitzy_recommendations (TRIAL_FIRST_SPEC §3)', () => {
  const ready = { fitzyRecommendationsReady: true, trialEligible: true, fitzyPlanReady: true };
  const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

  it('only free, non-trial users with goals set and a REAL plan preview — from session 1 (no sign-up delay)', () => {
    expect(fitzyRecommendations.audience(input(ready))).toBeNull();
    expect(fitzyRecommendations.audience(input(ready, { isPro: true }))).toBe('already_pro'); // Pro and trialing are premium
    expect(fitzyRecommendations.audience(input(ready, { isPro: null }))).toBe('tier_unknown');
    expect(fitzyRecommendations.audience(input(ready, { subscriptionsEnabled: false }))).toBe('subscriptions_off');
    expect(fitzyRecommendations.audience(input({ ...ready, fitzyRecommendationsReady: false }))).toBe('no_goals');
    expect(fitzyRecommendations.audience(input({ ...ready, fitzyRecommendationsReady: null }))).toBe('goals_unknown');
    expect(fitzyRecommendations.audience(input({ ...ready, signupAt: at(0.1) }))).toBeNull(); // minutes after sign-up
    expect(fitzyRecommendations.audience(input({ ...ready, hasLoggedMeal: false }))).toBeNull(); // no meal needed
    expect(fitzyRecommendations.audience(input({ ...ready, fitzyPlanReady: false }))).toBe('no_plan_yet');
    expect(fitzyRecommendations.audience(input({ ...ready, fitzyPlanReady: null }))).toBe('plan_unknown');
    expect(fitzyRecommendations.caps).toEqual({ perWeek: 3, cooldownHoursAfterDismiss: 72, hideAfterConversion: true });
    expect(PROMO_SCORES.fitzy_recommendations).toBeGreaterThan(PROMO_SCORES.pro_value);
  });

  it('day 0, brand-new free user (no meal yet): first_meal + the teaser; teaser replaces meet_fitzy and pro_value', () => {
    const cfg = promosConfig({ PROMOS_ENABLED: 'true' });
    const base = { definitions: SYSTEM_PROMOS, ctx: makeCtx({ now: NOW }), state: new Map(), liveProFeatures: new Set(['food_ai_unlimited']), client: CLIENT, config: cfg };
    const fresh = journey({ hasLoggedMeal: false, lastMeal: null, signupAt: at(0.5), ...ready });
    expect(selectPromos({ ...base, journey: fresh }).candidates.map((c) => c.promoKey)).toEqual(['first_meal', 'fitzy_recommendations']);
  });

  it('readiness = onboarding complete AND at least one goal; missing columns → unknown', () => {
    expect(fitzyRecommendationsReadyFrom({ onboarding_completed: true, goals: ['weight_loss'] })).toBe(true);
    expect(fitzyRecommendationsReadyFrom({ onboarding_completed: true, goals: [] })).toBe(false);
    expect(fitzyRecommendationsReadyFrom({ onboarding_completed: false, goals: ['health'] })).toBe(false);
    expect(fitzyRecommendationsReadyFrom({ onboarding_completed: true, goals: [' '] })).toBe(false);
    expect(fitzyRecommendationsReadyFrom({ id: 'x' })).toBeNull();
    const j = buildJourneyContext({ id: 'u', onboarding_completed: true, goals: ['health'], trial_started_at: null, subscription_platform: null }, null, { now: NOW, timezone: 'UTC', localDate: '2026-10-26' });
    expect(j).toMatchObject({ fitzyRecommendationsReady: true, trialEligible: true });
  });

  it('copy: trial-first when eligible, Pro copy otherwise; opens the paywall at placement fitzy_recommendations', () => {
    const [trial] = fitzyRecommendationsCreatives(true);
    expect(trial).toMatchObject({
      title: 'Fitzy has recommendations for you',
      body: 'Start your free 7-day trial to get your personalized plan.',
      primary: { label: 'Start free trial', action: { type: 'paywall', params: { placement: 'fitzy_recommendations' } } },
    });
    const [pro] = fitzyRecommendationsCreatives(false);
    expect(pro.primary.label).toBe('See Pro');
    expect(`${pro.title} ${pro.body}`).not.toMatch(/trial|free/i);
  });

  it('dropped for a client without paywall@1', () => {
    const client = parsePromoClient({ cardsSupportPromo: true, actions: 'open_screen@1', promoLayouts: 'banner' });
    const r = selectPromos({ definitions: [fitzyRecommendations], ctx: makeCtx({ now: NOW }), journey: journey(ready), state: new Map(), liveProFeatures: new Set(), client, config: promosConfig({ PROMOS_ENABLED: 'true' }) });
    expect(r.candidates).toHaveLength(0);
  });
});
