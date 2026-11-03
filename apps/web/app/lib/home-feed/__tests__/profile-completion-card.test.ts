import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { buildCandidates, parseClientCards } from '../candidates';
import { DEFAULT_ORDER } from '../catalog';
import { composeFeed } from '../compose';
import { buildFeedContext, type ContextLoaders } from '../context';
import { applyGuardrails, violations } from '../guardrails';
import type { ProfileCompletionFeedHint } from '../types';

import { IOS_CARDS, SPEC_CARDS, SPEC_SUPPORT, makeCtx, rule, types, withCampaign } from './helpers';

// docs/PROFILE_COMPLETION_CARD_SPEC.md — the "Complete your profile" card.

const HINT: ProfileCompletionFeedHint = {
  onboardingCompleted: true,
  snoozed: false,
  view: {
    percent: 43,
    answered: 3,
    total: 7,
    remaining: ['height', 'weight', 'birth_year', 'sex'],
    units: 'imperial',
    hints: { goal_weight: { healthy_min_kg: 58, healthy_max_kg: 78 } },
    goal: 'build_muscle',
  },
};
const IOS_NEW = parseClientCards(`${IOS_CARDS},profile_completion@1`);
const ANDROID_NEW = parseClientCards(`${SPEC_CARDS},profile_completion@1`);

describe('profile_completion feed card', () => {
  it('is never sent to clients that did not declare it (1.0.8+ fixtures unchanged)', () => {
    const { response } = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx({ profileCompletion: HINT }) });
    expect(types(response.cards)).not.toContain('profile_completion');
    expect(DEFAULT_ORDER).not.toContain('profile_completion');
  });

  it('declared + eligible → right after vitals (midway), with the spec props', () => {
    for (const support of [IOS_NEW, ANDROID_NEW]) {
      for (const extra of [{}, withCampaign()]) {
        const { response } = composeFeed({ support, ctx: makeCtx({ profileCompletion: HINT, ...extra }) });
        const order = types(response.cards);
        expect(order.indexOf('profile_completion')).toBe(order.indexOf('vitals') + 1);
        expect(order.indexOf('profile_completion')).toBeGreaterThan(order.indexOf('progress'));
        expect(violations(response.cards.slice(1))).toEqual([]);
      }
    }
    const { response } = composeFeed({ support: IOS_NEW, ctx: makeCtx({ profileCompletion: HINT }) });
    expect(response.cards.find((c) => c.type === 'profile_completion')).toEqual({
      id: 'profile_completion',
      type: 'profile_completion',
      version: 1,
      dismissible: true,
      props: {
        percent: 43,
        answered: 3,
        total: 7,
        remaining: ['height', 'weight', 'birth_year', 'sex'],
        units: 'imperial',
        hints: { goal_weight: { healthy_min_kg: 58, healthy_max_kg: 78 } },
        goal: 'build_muscle',
      },
    });
  });

  it('dropped when onboarding is incomplete, nothing remains, snoozed, or unknown; kill switch drops it too', () => {
    const reasons = (hint: ProfileCompletionFeedHint | null) =>
      buildCandidates(makeCtx({ profileCompletion: hint }), IOS_NEW).suppressed.map((c) => c.type);
    expect(reasons({ ...HINT, onboardingCompleted: false })).toContain('profile_completion');
    expect(reasons({ ...HINT, view: { ...HINT.view, percent: 100, answered: 7, remaining: [] } })).toContain('profile_completion');
    expect(reasons({ ...HINT, snoozed: true })).toContain('profile_completion');
    expect(reasons(null)).toContain('profile_completion');
    expect(buildCandidates(null, IOS_NEW).suppressed.map((c) => c.type)).toContain('profile_completion');
    expect(types(composeFeed({ support: IOS_NEW, ctx: null }).response.cards)).not.toContain('profile_completion');
  });

  it('G10: never in the first 3, even when a rule moves it to the top', () => {
    const r = rule({ key: 'pc_top', actions: [{ op: 'move', card: 'profile_completion', after: 'header' }] });
    const { response, trace } = composeFeed({ support: IOS_NEW, ctx: makeCtx({ profileCompletion: HINT }), rules: [r] });
    const idx = types(response.cards.slice(1)).indexOf('profile_completion'); // positions exclude offline_banner
    expect(idx).toBeGreaterThanOrEqual(3);
    expect(trace.guardrailAdjustments).toContain('profile_completion moved out of the first 3');
    // Tiny feed: moved down, or dropped when there's no slot 3.
    const tiny = applyGuardrails([{ id: 'header', type: 'header' }, { id: 'profile_completion', type: 'profile_completion' }, { id: 'hydration', type: 'hydration' }]);
    expect(types(tiny.cards)).toEqual(['header', 'hydration']);
    expect(violations([{ id: 'header', type: 'header' }, { id: 'pc', type: 'profile_completion' }])).toContain('G10 profile_completion in first 3');
  });
});

describe('profile completion context', () => {
  const profile = { id: 'u1', timezone: 'UTC', created_at: '2026-10-01T00:00:00Z', subscription_tier: 'free', preferences: {}, onboarding_completed: true };
  const info = { platform: 'ios' as const, appVersion: '1.2.0', appBuild: 90, clientTimezone: null };
  const loaders = (profileCompletion: ContextLoaders['profileCompletion']): ContextLoaders => ({
    campaign: async () => ({ present: false, slug: null, phase: null }),
    referralProgramEnabled: async () => true,
    subscriptionsEnabled: async () => true,
    activeCircleCount: async () => 1,
    checkedIn: async () => true,
    waterTodayMl: async () => 0,
    profileCompletion,
  });

  it('only runs the loader for clients that declare the card', async () => {
    const load = vi.fn(async () => HINT);
    const without = await buildFeedContext(profile, info, { loaders: loaders(load) });
    expect(load).not.toHaveBeenCalled();
    expect(without).not.toHaveProperty('profileCompletion');
    const withCard = await buildFeedContext(profile, info, { loaders: loaders(load), wantProfileCompletion: true });
    expect(withCard.profileCompletion).toEqual(HINT);
  });

  it('a failing loader is unknown (null) → card dropped, feed still renders', async () => {
    const ctx = await buildFeedContext(profile, info, {
      loaders: loaders(async () => {
        throw new Error('db');
      }),
      wantProfileCompletion: true,
    });
    expect(ctx.profileCompletion).toBeNull();
    expect(types(composeFeed({ support: IOS_NEW, ctx }).response.cards)).not.toContain('profile_completion');
  });
});
