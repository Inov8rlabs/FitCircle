import { describe, expect, it } from 'vitest';

import { decideAssignment, hardPaywallIneligibility, hasLiveHardArm, type AssignmentContext } from '../assign';
import { armsSchema, patchExperimentSchema, type Experiment, type ExperimentArm } from '../model';
import {
  AFTER_MEAL_PAYLOAD,
  FORCED_TRIAL_ARM_NAME,
  FORCED_TRIAL_PAYLOAD,
  parseAllocation,
  planForcedTrialPatch,
  RECOMMENDED_ALLOCATION,
} from '../onboarding-forced-trial';

const NOW = new Date('2026-11-20T12:00:00Z');
const USER = 'a1b2c3d4-0000-4000-8000-000000000001';

/** Prod as of 2026-11-17 (control 100 %, variantA–C at 0, no variantD yet). */
const PROD_ARMS: ExperimentArm[] = [
  { key: 'control', name: 'Plans + trial timeline', description: null, weight: 100, payload: { layout: 'plans', paywall: 'soft', trial_timeline: true } },
  { key: 'variantA', name: 'Your plan recap', description: null, weight: 0, payload: { layout: 'plan_recap', paywall: 'soft' } },
  { key: 'variantB', name: 'Annual with savings vs monthly', description: null, weight: 0, payload: { layout: 'annual_savings', paywall: 'soft' } },
  { key: 'variantC', name: 'Later after 5s', description: null, weight: 0, payload: { later_delay_s: 5, layout: 'plans', paywall: 'soft', trial_timeline: true } },
];
const PROD_AUDIENCE = { platforms: ['ios', 'android'] as ('ios' | 'android')[], minAppVersion: '1.1.0', newUsersOnly: true, excludeUserIds: ['47476150-a984-4431-a89a-7cc8085adfe6'] };

const experiment = (arms: ExperimentArm[]): Experiment => ({
  key: 'onboarding_paywall',
  name: 'Onboarding paywall',
  description: null,
  status: 'running',
  salt: 's',
  arms,
  trafficPct: 100,
  audience: PROD_AUDIENCE,
  fallbackArm: 'control',
  winnerArm: null,
  layer: null,
  startedAt: null,
  endedAt: null,
  createdBy: null,
  createdAt: null,
  updatedAt: null,
});
const ctx = (over: Partial<AssignmentContext> = {}): AssignmentContext => ({
  userId: USER,
  platform: 'ios',
  appVersion: '1.1.5',
  appBuild: null,
  country: 'US',
  profileCreatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  onboardingCompleted: false,
  hasComplimentaryGrant: false,
  now: NOW,
  ...over,
});

const planned = planForcedTrialPatch({ key: 'onboarding_paywall', arms: PROD_ARMS, audience: PROD_AUDIENCE }, RECOMMENDED_ALLOCATION);
const LIVE = experiment(planned.patch.arms!);
const ALL_FORCED = experiment(planned.patch.arms!.map((a) => ({ ...a, weight: a.key === planned.forcedKey ? 100 : 0 })));

describe('planForcedTrialPatch (scripts/onboarding-forced-trial-experiment.ts)', () => {
  it('against prod: adds variantD "After first meal" and variantE "Forced trial (no close)", 50/50 control vs forced, min 1.1.5', () => {
    expect(planned.afterMealKey).toBe('variantD');
    expect(planned.forcedKey).toBe('variantE');
    expect(planned.patch.arms!.map((a) => [a.key, a.weight])).toEqual([
      ['control', 50],
      ['variantA', 0],
      ['variantB', 0],
      ['variantC', 0],
      ['variantD', 0],
      ['variantE', 50],
    ]);
    const e = planned.patch.arms!.find((a) => a.key === 'variantE')!;
    expect(e.name).toBe(FORCED_TRIAL_ARM_NAME);
    expect(e.payload).toEqual({ layout: 'plans', paywall: 'hard', trial_timeline: true });
    expect(planned.patch.arms!.find((a) => a.key === 'variantD')!.payload).toEqual(AFTER_MEAL_PAYLOAD);
    // Existing arms untouched apart from weight.
    expect(planned.patch.arms!.slice(0, 4).map(({ weight: _w, ...a }) => a)).toEqual(PROD_ARMS.map(({ weight: _w, ...a }) => a));
    expect(planned.patch.audience).toEqual({ ...PROD_AUDIENCE, minAppVersion: '1.1.5' });
    expect(() => patchExperimentSchema.parse(planned.patch)).not.toThrow();
  });

  it('uses an existing variantD and is idempotent', () => {
    const withD = [...PROD_ARMS, { key: 'variantD', name: 'After first meal', description: null, weight: 0, payload: { ...AFTER_MEAL_PAYLOAD } }];
    const first = planForcedTrialPatch({ key: 'onboarding_paywall', arms: withD, audience: PROD_AUDIENCE }, RECOMMENDED_ALLOCATION);
    expect(first.forcedKey).toBe('variantE');
    expect(first.patch.arms).toHaveLength(6);
    const again = planForcedTrialPatch({ key: 'onboarding_paywall', arms: first.patch.arms!, audience: first.patch.audience! }, RECOMMENDED_ALLOCATION);
    expect(again.changes).toEqual([]);
    expect(again.patch.audience).toBeUndefined();
  });

  it('allocation is a parameter (3-way, or later resume variantD)', () => {
    const three = planForcedTrialPatch({ key: 'onboarding_paywall', arms: PROD_ARMS, audience: PROD_AUDIENCE }, parseAllocation('control=34,forced=33,afterMeal=33'));
    expect(three.patch.arms!.map((a) => a.weight)).toEqual([34, 0, 0, 0, 33, 33]);
    expect(() => armsSchema.parse(three.patch.arms)).not.toThrow();
  });

  it('rejects allocations that do not sum to 100 or bad syntax', () => {
    expect(() => parseAllocation('control=50,forced=40')).toThrow(/sum to 100/);
    expect(() => parseAllocation('control=50,hard=50')).toThrow(/bad --split/);
    expect(parseAllocation(undefined)).toEqual({ control: 50, forced: 50, afterMeal: 0 });
  });

  it('never lowers a higher audience minimum', () => {
    const p = planForcedTrialPatch({ key: 'onboarding_paywall', arms: PROD_ARMS, audience: { ...PROD_AUDIENCE, minAppVersion: '1.2.0' } }, RECOMMENDED_ALLOCATION);
    expect(p.patch.audience).toBeUndefined();
  });

  it('refuses another experiment', () => {
    expect(() => planForcedTrialPatch({ key: 'onboarding_v2', arms: PROD_ARMS, audience: {} }, RECOMMENDED_ALLOCATION)).toThrow();
  });
});

describe('hard-paywall eligibility (lib/experiments/assign.ts)', () => {
  it('only while a hard arm can be drawn', () => {
    expect(hasLiveHardArm(LIVE)).toBe(true);
    expect(hasLiveHardArm(experiment(PROD_ARMS))).toBe(false);
    expect(hardPaywallIneligibility(experiment(PROD_ARMS), ctx({ invited: true, appVersion: '1.1.0' }))).toBeNull();
  });

  it.each([
    ['invited', { invited: true }, 'invited'],
    ['Pro', { isPro: true }, 'pro'],
    ['1.1.4', { appVersion: '1.1.4' }, 'app_version_hard_paywall'],
    ['no version', { appVersion: null }, 'app_version_hard_paywall'],
  ])('%s → %s', (_l, over, reason) => {
    expect(hardPaywallIneligibility(LIVE, ctx(over))).toBe(reason);
    const d = decideAssignment(ALL_FORCED, ctx(over), { override: null, existing: null });
    expect(d).toMatchObject({ arm: 'control', reason: 'fallback', persist: false, enrolled: false });
    expect(d.ineligible).toBeTruthy(); // the stored audience (min 1.1.0) may answer first
  });

  it('1.1.5 / 1.1.10 non-invited → eligible; ALL_FORCED draws the forced arm', () => {
    expect(hardPaywallIneligibility(LIVE, ctx())).toBeNull();
    expect(hardPaywallIneligibility(LIVE, ctx({ appVersion: '1.1.10 (99)' }))).toBeNull();
    expect(decideAssignment(ALL_FORCED, ctx(), { override: null, existing: null })).toMatchObject({ arm: 'variantE', reason: 'bucket', persist: true });
  });

  it('invited after assignment: unexposed + onboarding → rewrite to fallback (any arm); otherwise sticky', () => {
    const rewrite = decideAssignment(LIVE, ctx({ invited: true }), { override: null, existing: { arm: 'variantE', reason: 'bucket', exposed: false } });
    expect(rewrite).toMatchObject({ arm: 'control', reason: 'fallback', persist: true, replace: true, ineligible: 'invited' });
    // Control rows leave the analysis too, so the arms lose invited users alike.
    expect(decideAssignment(LIVE, ctx({ invited: true }), { override: null, existing: { arm: 'control', reason: 'bucket', exposed: false } })).toMatchObject({
      arm: 'control',
      reason: 'fallback',
      replace: true,
    });
    // Already rewritten → no write.
    expect(decideAssignment(LIVE, ctx({ invited: true }), { override: null, existing: { arm: 'control', reason: 'fallback', exposed: false } })).toMatchObject({
      persist: false,
    });
    for (const [over, existing] of [
      [{ invited: true }, { arm: 'variantE', reason: 'bucket' as const, exposed: true }],
      [{ invited: true }, { arm: 'variantE', reason: 'bucket' as const }],
      [{ invited: true, onboardingCompleted: true }, { arm: 'variantE', reason: 'bucket' as const, exposed: false }],
      [{ invited: false }, { arm: 'variantE', reason: 'bucket' as const, exposed: false }],
    ] as const) {
      expect(decideAssignment(LIVE, ctx(over), { override: null, existing })).toMatchObject({ arm: 'variantE', persist: false });
    }
  });

  it('QA override still serves the forced arm (testing), invited or not', () => {
    expect(decideAssignment(LIVE, ctx({ invited: true, appVersion: '1.1.4' }), { override: { arm: 'variantE' }, existing: null })).toMatchObject({
      arm: 'variantE',
      payload: FORCED_TRIAL_PAYLOAD,
      reason: 'override',
    });
  });
});
