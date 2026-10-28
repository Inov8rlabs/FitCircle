import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { armForBucket, decideAssignment, ineligibilityReason, inTraffic, type AssignmentContext } from '../assign';
import { experimentBucket } from '../bucket';
import {
  applyPatch,
  armsSchema,
  canTransition,
  createExperimentSchema,
  ExperimentValidationError,
  overrideInputSchema,
  type Experiment,
} from '../model';

const NOW = new Date('2026-11-10T12:00:00Z');
const uuid = (i: number) => {
  const h = createHash('md5').update(`u${i}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const experiment = (over: Partial<Experiment> = {}): Experiment => ({
  key: 'onboarding_v2',
  name: 'Onboarding v2',
  description: null,
  status: 'running',
  salt: 'test-salt',
  arms: [
    { key: 'control', weight: 20, payload: { flow: 'v1' } },
    { key: 'tour_hard', weight: 40, payload: { flow: 'v2', paywall: 'hard' } },
    { key: 'tour_soft', weight: 40, payload: { flow: 'v2', paywall: 'soft' } },
  ],
  trafficPct: 100,
  audience: { platforms: ['ios', 'android'], minAppVersion: '1.2.0', newUsersOnly: true, excludeUserIds: ['47476150-a984-4431-a89a-7cc8085adfe6'] },
  fallbackArm: 'control',
  winnerArm: null,
  startedAt: null,
  endedAt: null,
  createdBy: null,
  createdAt: null,
  updatedAt: null,
  ...over,
});

const ctx = (over: Partial<AssignmentContext> = {}): AssignmentContext => ({
  userId: uuid(1),
  platform: 'ios',
  appVersion: '1.2.0',
  country: 'US',
  profileCreatedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
  onboardingCompleted: false,
  hasComplimentaryGrant: false,
  now: NOW,
  ...over,
});

const none = { override: null, existing: null };

describe('eligibility (audience)', () => {
  it('new iOS/Android 1.2.0+ user is eligible', () => {
    expect(ineligibilityReason(experiment().audience, ctx())).toBeNull();
    expect(ineligibilityReason(experiment().audience, ctx({ platform: 'android', appVersion: '1.2.1 (40)' }))).toBeNull();
  });

  it.each([
    ['web', { platform: 'web' as const }, 'platform'],
    ['no platform header', { platform: null }, 'platform'],
    ['old app', { appVersion: '1.1.9' }, 'app_version'],
    ['no version header', { appVersion: null }, 'app_version'],
    ['account older than 24 h', { profileCreatedAt: new Date(NOW.getTime() - 25 * 3_600_000).toISOString() }, 'not_new_user'],
    ['onboarding already done', { onboardingCompleted: true }, 'onboarding_completed'],
    ['complimentary Pro', { hasComplimentaryGrant: true }, 'complimentary_grant'],
    ['reviewer demo account', { userId: '47476150-A984-4431-A89A-7CC8085ADFE6' }, 'excluded_user'],
  ])('%s → %s', (_label, over, reason) => {
    expect(ineligibilityReason(experiment().audience, ctx(over))).toBe(reason);
  });

  it('countries are optional and case-insensitive', () => {
    const a = { ...experiment().audience, countries: ['US', 'CA'] };
    expect(ineligibilityReason(a, ctx({ country: 'ca' }))).toBeNull();
    expect(ineligibilityReason(a, ctx({ country: 'GB' }))).toBe('country');
    expect(ineligibilityReason(a, ctx({ country: null }))).toBe('country');
  });
});

describe('decideAssignment order', () => {
  it('ineligible → fallback, enrolled=false, NOT persisted', () => {
    const d = decideAssignment(experiment(), ctx({ platform: 'web' }), none);
    expect(d).toMatchObject({ arm: 'control', reason: 'fallback', enrolled: false, persist: false, ineligible: 'platform' });
  });

  it('override beats everything (even ineligibility) and persists once', () => {
    const d = decideAssignment(experiment({ status: 'draft' }), ctx({ platform: 'web' }), { override: { arm: 'tour_hard' }, existing: null });
    expect(d).toMatchObject({ arm: 'tour_hard', reason: 'override', enrolled: false, persist: true, payload: { flow: 'v2', paywall: 'hard' } });
    const again = decideAssignment(experiment(), ctx(), { override: { arm: 'tour_hard' }, existing: { arm: 'tour_hard', reason: 'override' } });
    expect(again.persist).toBe(false);
    const changed = decideAssignment(experiment(), ctx(), { override: { arm: 'tour_soft' }, existing: { arm: 'tour_hard', reason: 'override' } });
    expect(changed).toMatchObject({ arm: 'tour_soft', persist: true });
  });

  it('sticky: an existing assignment is returned even when no longer eligible, paused or reweighted', () => {
    const existing = { arm: 'tour_soft', reason: 'bucket' as const };
    const later = ctx({ profileCreatedAt: '2026-01-01T00:00:00Z', onboardingCompleted: true });
    const reweighted = experiment({ status: 'paused', arms: [{ key: 'control', weight: 100, payload: {} }, { key: 'tour_hard', weight: 0, payload: {} }, { key: 'tour_soft', weight: 0, payload: {} }] });
    expect(decideAssignment(reweighted, later, { override: null, existing })).toMatchObject({ arm: 'tour_soft', reason: 'bucket', enrolled: true, persist: false });
  });

  it('draft / paused → fallback, persisted (sticky through a later start)', () => {
    for (const status of ['draft', 'paused'] as const) {
      expect(decideAssignment(experiment({ status }), ctx(), none)).toMatchObject({ arm: 'control', reason: 'fallback', enrolled: false, persist: true });
    }
  });

  it('concluded → winner for new users, persisted; existing keep their arm', () => {
    const e = experiment({ status: 'concluded', winnerArm: 'tour_soft' });
    expect(decideAssignment(e, ctx(), none)).toMatchObject({ arm: 'tour_soft', reason: 'winner', enrolled: false, persist: true });
    expect(decideAssignment(e, ctx(), { override: null, existing: { arm: 'tour_hard', reason: 'bucket' } }).arm).toBe('tour_hard');
  });

  it('running: bucket → weighted arm, enrolled, persisted; deterministic', () => {
    const d = decideAssignment(experiment(), ctx(), none);
    expect(d.reason).toBe('bucket');
    expect(d.enrolled).toBe(true);
    expect(d.persist).toBe(true);
    expect(decideAssignment(experiment(), ctx(), none).arm).toBe(d.arm);
    expect(d.arm).toBe(armForBucket(experiment().arms, experimentBucket(ctx().userId, 'test-salt'))!.key);
  });

  it('20/40/40 split is honoured', () => {
    const counts: Record<string, number> = { control: 0, tour_hard: 0, tour_soft: 0 };
    const N = 6000;
    for (let i = 0; i < N; i++) counts[decideAssignment(experiment(), ctx({ userId: uuid(i) }), none).arm]++;
    expect(counts.control / N).toBeGreaterThan(0.17);
    expect(counts.control / N).toBeLessThan(0.23);
    expect(counts.tour_hard / N).toBeGreaterThan(0.37);
    expect(counts.tour_soft / N).toBeGreaterThan(0.37);
  });

  it('traffic_pct gates enrolment independently of the arm hash; raising it never moves anyone between arms', () => {
    const at20 = experiment({ trafficPct: 20 });
    const at100 = experiment({ trafficPct: 100 });
    let enrolled = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const c = ctx({ userId: uuid(i) });
      const a = decideAssignment(at20, c, none);
      if (a.enrolled) {
        enrolled++;
        expect(decideAssignment(at100, c, none).arm).toBe(a.arm);
      } else {
        expect(a).toMatchObject({ arm: 'control', reason: 'fallback', persist: true });
        expect(inTraffic(at20, c.userId)).toBe(false);
      }
    }
    expect(enrolled / N).toBeGreaterThan(0.17);
    expect(enrolled / N).toBeLessThan(0.23);
  });

  it('0 % traffic enrols nobody', () => {
    for (let i = 0; i < 200; i++) expect(decideAssignment(experiment({ trafficPct: 0 }), ctx({ userId: uuid(i) }), none).enrolled).toBe(false);
  });
});

describe('model validation', () => {
  it('weights must sum to 100 and arm keys be unique', () => {
    expect(armsSchema.safeParse([{ key: 'a', weight: 50 }, { key: 'b', weight: 40 }]).success).toBe(false);
    expect(armsSchema.safeParse([{ key: 'a', weight: 50 }, { key: 'a', weight: 50 }]).success).toBe(false);
    expect(armsSchema.safeParse([{ key: 'a', weight: 50 }, { key: 'b', weight: 50 }]).success).toBe(true);
  });

  it('fallbackArm must be an arm', () => {
    const base = { key: 'x', name: 'X', arms: [{ key: 'a', weight: 100 }] };
    expect(createExperimentSchema.safeParse({ ...base, fallbackArm: 'b' }).success).toBe(false);
    expect(createExperimentSchema.safeParse({ ...base, fallbackArm: 'a' }).success).toBe(true);
  });

  it('override input needs exactly one of email / userId', () => {
    expect(overrideInputSchema.safeParse({ arm: 'a' }).success).toBe(false);
    expect(overrideInputSchema.safeParse({ arm: 'a', email: 'x@y.co', userId: uuid(1) }).success).toBe(false);
    expect(overrideInputSchema.safeParse({ arm: 'a', email: 'x@y.co' }).success).toBe(true);
  });

  it('lifecycle transitions', () => {
    expect(canTransition('draft', 'running')).toBe(true);
    expect(canTransition('running', 'paused')).toBe(true);
    expect(canTransition('paused', 'running')).toBe(true);
    expect(canTransition('running', 'draft')).toBe(false);
    expect(canTransition('concluded', 'running')).toBe(false);
    expect(canTransition('draft', 'concluded')).toBe(false);
  });

  it('applyPatch: start stamps started_at; conclude needs an existing winner', () => {
    const started = applyPatch(experiment({ status: 'draft' }), { status: 'running' }, { now: NOW, hasAssignments: false });
    expect(started.startedAt).toBe(NOW.toISOString());
    expect(() => applyPatch(experiment(), { status: 'concluded' }, { now: NOW, hasAssignments: true })).toThrow(ExperimentValidationError);
    expect(() => applyPatch(experiment(), { status: 'concluded', winnerArm: 'nope' }, { now: NOW, hasAssignments: true })).toThrow(/winnerArm/);
    const done = applyPatch(experiment(), { status: 'concluded', winnerArm: 'tour_soft' }, { now: NOW, hasAssignments: true });
    expect(done).toMatchObject({ status: 'concluded', winnerArm: 'tour_soft', endedAt: NOW.toISOString() });
  });

  it('applyPatch: arms in use cannot be removed; fallback must stay valid', () => {
    expect(() =>
      applyPatch(experiment(), { arms: [{ key: 'control', weight: 50, payload: {} }, { key: 'tour_soft', weight: 50, payload: {} }] }, { now: NOW, hasAssignments: true })
    ).toThrow(/cannot be removed/);
    expect(() => applyPatch(experiment(), { fallbackArm: 'ghost' }, { now: NOW, hasAssignments: false })).toThrow(/fallbackArm/);
    const reweighted = applyPatch(
      experiment(),
      { arms: [{ key: 'control', weight: 10, payload: {} }, { key: 'tour_hard', weight: 45, payload: {} }, { key: 'tour_soft', weight: 45, payload: {} }] },
      { now: NOW, hasAssignments: true }
    );
    expect(reweighted.arms.map((a) => a.weight)).toEqual([10, 45, 45]);
  });
});
