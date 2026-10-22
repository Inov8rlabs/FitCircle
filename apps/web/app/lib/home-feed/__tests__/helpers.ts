import { parseClientCards } from '../candidates';
import type { FeedRule } from '../rules';
import { ruleDefinitionSchema } from '../rules';
import type { FeedContext } from '../types';

/** The exact `cards=` list from HOME_FEED_SPEC §2 (what 1.0.8 clients send). */
export const SPEC_CARDS =
  'header@1,campaign@1,hydration@1,referral@1,pro_upsell@1,streak_warning@1,daily_goals@1,progress@1,vitals@1,body_comp@1,past_date_log@1,native_ad@1,charts@1,fitzy_focus@1,health_sync_banner@1,offline_banner@1';
export const SPEC_SUPPORT = parseClientCards(SPEC_CARDS);

export const USER = '11111111-1111-4111-8111-111111111111';

/** A fully-known context: free user, circle, no campaign, referrals + subscriptions on, morning. */
export function makeCtx(overrides: Partial<FeedContext> = {}): FeedContext {
  return {
    userId: USER,
    now: new Date('2026-10-22T16:00:00Z'),
    platform: 'ios',
    appVersion: '1.0.8',
    appBuild: 63,
    timezone: 'America/Los_Angeles',
    localDate: '2026-10-22',
    localHour: 9,
    localWeekday: 4,
    daysSinceSignup: 30,
    isPro: false,
    subscriptionsEnabled: true,
    hasCircle: true,
    circleCount: 1,
    campaign: { present: false, slug: null, phase: null },
    referralProgramEnabled: true,
    checkedInToday: true,
    streakAtRisk: false,
    waterLoggedToday: false,
    adsEligible: true,
    ...overrides,
  };
}

export const withCampaign = (slug = 'hold_the_line', phase = 'live'): Partial<FeedContext> => ({
  campaign: { present: true, slug, phase },
});

/** Build a FeedRule from a flat literal (validated, so tests also exercise the schema). */
export function rule(r: { key: string; enabled?: boolean; priority?: number } & Record<string, unknown>): FeedRule {
  const { key, enabled = true, priority = 0, ...def } = r;
  return { ...ruleDefinitionSchema.parse(def), key, enabled, priority };
}

export const types = (cards: { type: string }[]) => cards.map((c) => c.type);
