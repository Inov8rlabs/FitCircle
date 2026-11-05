/**
 * Same user, same rules → the same card order on iOS and Android
 * (2026-11-05 bug: the published Admin Tools layout moves `campaign` after
 * `missing_days`; iOS never declares missing_days, so on iOS that move was a
 * no-op and Hold the Line stayed above hydration, while Android got it at the
 * bottom as the editor shows). A move whose anchor this client doesn't have
 * now lands where the anchor would have been.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_MEAL_REMINDER_PREFS } from '../../journey/meal-slots';
import { ACTION_TYPES, SYSTEM_PROMOS, parsePromoClient, promosConfig, selectPromos, type JourneyContext } from '../../promos';
import { PROMO_STYLE_FIRST_112_BUILD, defaultClientDeclaration } from '../../services/home-feed-admin-service';
import { parseClientCards } from '../candidates';
import { composeFeed } from '../compose';
import type { FeedRule } from '../rules';

import { makeCtx, rule, withCampaign } from './helpers';

/** The rule published in prod (home_feed_rules.admin_layout_everyone, read 2026-11-05). */
const ADMIN_LAYOUT_EVERYONE: FeedRule = rule({
  key: 'admin_layout_everyone',
  priority: 1000,
  platforms: ['ios', 'android'],
  minAppVersion: '1.0.8',
  actions: [
    { op: 'move', card: 'fitzy_focus', after: 'header' },
    { op: 'move', card: 'daily_goals', after: 'circle_chat' },
    { op: 'move', card: 'progress', after: 'daily_goals' },
    { op: 'move', card: 'pro_upsell', after: 'progress' },
    { op: 'move', card: 'campaign', after: 'missing_days' },
    { op: 'move', card: 'referral', before: 'vitals' },
  ],
});

/** The exact `cards=` each 1.1.2 build sends (iOS HomeFeedCardType.allCases / Android HomeFeedCardType.entries, client-only fitzy_hint excluded). */
const IOS_112_CARDS =
  'offline_banner@1,header@1,health_sync_banner@1,campaign@1,hydration@1,referral@1,pro_upsell@1,streak_warning@1,daily_goals@1,fitzy_focus@1,progress@1,vitals@1,body_comp@1,past_date_log@1,native_ad@1,charts@1,promo@1,circle_chat@1,profile_completion@1';
const ANDROID_112_CARDS =
  'offline_banner@1,header@1,health_sync_banner@1,circle_chat@1,campaign@1,hydration@1,referral@1,pro_upsell@1,streak_warning@1,missing_days@1,daily_goals@1,fitzy_focus@1,progress@1,vitals@1,body_comp@1,past_date_log@1,native_ad@1,charts@1,promo@1,profile_completion@1';
/** Android 1.1.1 (Play production, 935354c): the same list without profile_completion. */
const ANDROID_111_CARDS = ANDROID_112_CARDS.replace(',profile_completion@1', '');

const CLIENT = parsePromoClient({ cardsSupportPromo: true, actions: ACTION_TYPES.map((t) => `${t}@1`).join(','), promoLayouts: 'hero,banner,compact' });
const CFG = promosConfig({ PROMOS_ENABLED: 'true' });

/** 3:30 pm, breakfast + lunch logged → the "Log your snack" promo (log_meal_now). */
const journey: JourneyContext = {
  hasLoggedMeal: true,
  loggedSlotsToday: ['breakfast', 'lunch'],
  lastMeal: { title: 'Salad', mealType: 'lunch' },
  signupAt: '2026-10-01T00:00:00Z',
  fitzyOpenedAt: '2026-10-02T00:00:00Z',
  mealReminderPrefs: { ...DEFAULT_MEAL_REMINDER_PREFS },
  localMinutes: 15 * 60 + 30,
};

function feed(platform: 'ios' | 'android', cards: string, opts: { isPro?: boolean; version?: string } = {}) {
  const ctx = makeCtx({ ...withCampaign('hold_the_line'), platform, appVersion: opts.version ?? '1.1.2', localHour: 15, isPro: opts.isPro ?? true });
  const support = parseClientCards(cards);
  const promos = selectPromos({ definitions: SYSTEM_PROMOS, ctx, journey, state: new Map(), liveProFeatures: new Set(['food_ai_unlimited']), client: CLIENT, config: CFG });
  const r = composeFeed({ support, ctx, rules: [ADMIN_LAYOUT_EVERYONE], promos: promos.candidates, replacedTypes: new Set(['pro_upsell']), promoV1: true });
  return r.response.cards.map((c) => c.id);
}

/** Order of the cards both platforms can draw. */
const common = (ids: string[]) => ids.filter((id) => id !== 'missing_days');

describe('home feed order is the same on iOS and Android (admin_layout_everyone)', () => {
  it('Pro user, Hold the Line live, snack time: Log snack → hydration → … → campaign on both', () => {
    const ios = feed('ios', IOS_112_CARDS);
    const android = feed('android', ANDROID_112_CARDS);
    expect(android).toEqual([
      'offline_banner',
      'header',
      'fitzy_focus',
      'health_sync_banner',
      'circle_chat',
      'daily_goals',
      'progress',
      'promo:log_meal_now',
      'hydration',
      'streak_warning',
      'missing_days',
      'campaign:hold_the_line',
      'vitals',
      'body_comp',
      'past_date_log',
      'charts',
    ]);
    expect(ios).toEqual(common(android));
  });

  it('free user: same order on both platforms (G7 keeps the 2 higher-ranked promos; the campaign ranks last)', () => {
    const ios = feed('ios', IOS_112_CARDS, { isPro: false });
    const android = feed('android', ANDROID_112_CARDS, { isPro: false });
    expect(ios).toEqual(common(android));
    expect(android.filter((id) => id.startsWith('promo:') || id.startsWith('campaign:'))).toEqual(['promo:log_meal_now', 'promo:pro_value']);
  });

  it('shipped Android 1.1.1 gets the same order as 1.1.2', () => {
    expect(feed('android', ANDROID_111_CARDS, { version: '1.1.1' })).toEqual(feed('android', ANDROID_112_CARDS));
  });

  it("the admin preview's declared card lists give the same order as the real requests", () => {
    const ios = feed('ios', defaultClientDeclaration('ios', '1.1.2').cards);
    const android = feed('android', defaultClientDeclaration('android', '1.1.2').cards);
    expect(ios).toEqual(common(android));
  });
});

describe('defaultClientDeclaration matches what each shipped build sends', () => {
  const set = (cards: string) => new Set(cards.split(','));

  it('1.1.2: exactly the cards= of iOS HomeFeedCardType / Android HomeFeedCardType (profile_completion on both, missing_days on Android only)', () => {
    expect(set(defaultClientDeclaration('ios', '1.1.2').cards)).toEqual(set(IOS_112_CARDS));
    expect(set(defaultClientDeclaration('android', '1.1.2').cards)).toEqual(set(ANDROID_112_CARDS));
  });

  it('1.1.1 and older do not declare profile_completion', () => {
    expect(set(defaultClientDeclaration('android', '1.1.1').cards)).toEqual(set(ANDROID_111_CARDS));
    expect(defaultClientDeclaration('ios', '1.1.1').cards).not.toContain('profile_completion');
  });

  it('promo_style@1: 1.1.2 from iOS build 89 / Android vc51, every 1.1.3+, never 1.1.1', () => {
    expect(PROMO_STYLE_FIRST_112_BUILD).toEqual({ ios: 89, android: 51 });
    expect(defaultClientDeclaration('ios', '1.1.2', 88).features).toBeNull();
    expect(defaultClientDeclaration('ios', '1.1.2', 89).features).toBe('promo_style@1');
    expect(defaultClientDeclaration('android', '1.1.2', 50).features).toBeNull();
    expect(defaultClientDeclaration('android', '1.1.2', 52).features).toBe('promo_style@1');
    // No build: an early 1.1.2 (the promo-style editor's "today's apps" side relies on this).
    expect(defaultClientDeclaration('ios', '1.1.2').features).toBeNull();
    expect(defaultClientDeclaration('android', '1.1.3').features).toBe('promo_style@1');
    expect(defaultClientDeclaration('ios', '1.1.1', 999).features).toBeNull();
  });
});
