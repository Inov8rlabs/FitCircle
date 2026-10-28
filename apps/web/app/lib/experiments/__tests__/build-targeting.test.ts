/**
 * Build targeting (audience.minBuild / maxBuild per platform, appVersions allow-list)
 * and X-App-Build parsing — docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.3 "Targeting builds".
 */
import { describe, expect, it } from 'vitest';

import { decideAssignment, ineligibilityReason, type AssignmentContext } from '../assign';
import { audienceSchema, createExperimentSchema, patchExperimentSchema, type Experiment, type ExperimentAudience } from '../model';
import { parseAppBuild, readExperimentRequestInfo } from '../request-info';

const NOW = new Date('2026-11-10T12:00:00Z');
const USER = 'a1b2c3d4-0000-4000-8000-000000000001';

const ctx = (over: Partial<AssignmentContext> = {}): AssignmentContext => ({
  userId: USER,
  platform: 'ios',
  appVersion: '1.1.0',
  appBuild: 74,
  country: 'US',
  profileCreatedAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
  onboardingCompleted: false,
  hasComplimentaryGrant: false,
  now: NOW,
  ...over,
});

const audience = (a: unknown): ExperimentAudience => audienceSchema.parse(a);

describe('audience schema: build bounds + appVersions', () => {
  it('accepts per-platform positive integer bounds and an exact-version list', () => {
    expect(audience({ minBuild: { ios: 74, android: 38 }, maxBuild: { web: 5 }, appVersions: ['1.1.0', '1.1.1'] })).toEqual({
      minBuild: { ios: 74, android: 38 },
      maxBuild: { web: 5 },
      appVersions: ['1.1.0', '1.1.1'],
    });
  });

  it.each([
    ['zero build', { minBuild: { ios: 0 } }],
    ['negative build', { minBuild: { android: -1 } }],
    ['fractional build', { maxBuild: { ios: 74.5 } }],
    ['string build', { minBuild: { ios: '74' } }],
    ['unknown platform key', { minBuild: { watchos: 3 } }],
    ['min above max on the same platform', { minBuild: { ios: 80 }, maxBuild: { ios: 79 } }],
    ['empty appVersions', { appVersions: [] }],
    ['21 appVersions', { appVersions: Array.from({ length: 21 }, (_, i) => `1.${i}.0`) }],
    ['bad version string', { appVersions: ['1.1.0-beta'] }],
    ['unknown audience field', { minBuilds: { ios: 1 } }],
  ])('rejects %s', (_label, a) => {
    expect(audienceSchema.safeParse(a).success).toBe(false);
  });

  it('min = max is allowed (exactly one build); bounds on different platforms never conflict', () => {
    expect(audienceSchema.safeParse({ minBuild: { ios: 74 }, maxBuild: { ios: 74 } }).success).toBe(true);
    expect(audienceSchema.safeParse({ minBuild: { ios: 80 }, maxBuild: { android: 10 } }).success).toBe(true);
  });

  it('an empty bound object is stored as "no bound" (key dropped)', () => {
    const a = audience({ platforms: ['ios'], minBuild: {}, maxBuild: {} });
    expect(a).toEqual({ platforms: ['ios'] });
    expect('minBuild' in a).toBe(false);
  });

  it('the live onboarding_paywall audience parses to exactly itself (no new keys)', () => {
    const live = { platforms: ['ios', 'android'], minAppVersion: '1.1.0', newUsersOnly: true, excludeUserIds: ['47476150-a984-4431-a89a-7cc8085adfe6'] };
    expect(audience(live)).toEqual(live);
    expect(Object.keys(audience(live)).sort()).toEqual(Object.keys(live).sort());
  });

  it('admin create / patch schemas carry the new fields', () => {
    const arms = [{ key: 'control', name: 'C', weight: 100, payload: {} }];
    const created = createExperimentSchema.parse({ key: 'x', name: 'X', arms, audience: { minBuild: { ios: 74 }, appVersions: ['1.1.0'] } });
    expect(created.audience).toEqual({ minBuild: { ios: 74 }, appVersions: ['1.1.0'] });
    expect(patchExperimentSchema.parse({ audience: { maxBuild: { android: 40 } } }).audience).toEqual({ maxBuild: { android: 40 } });
    expect(patchExperimentSchema.safeParse({ audience: { minBuild: { ios: 'x' } } }).success).toBe(false);
  });
});

describe('gate matrix: build bounds', () => {
  const bounded = audience({ platforms: ['ios', 'android'], minAppVersion: '1.1.0', minBuild: { ios: 74, android: 38 } });

  it.each([
    ['iOS at the min build', { platform: 'ios' as const, appBuild: 74 }, null],
    ['iOS above the min build', { platform: 'ios' as const, appBuild: 90 }, null],
    ['iOS early TestFlight build of the same version', { platform: 'ios' as const, appBuild: 72 }, 'app_build'],
    ['iOS with no X-App-Build', { platform: 'ios' as const, appBuild: null }, 'app_build'],
    ['Android at the min versionCode', { platform: 'android' as const, appBuild: 38 }, null],
    ['Android early versionCode', { platform: 'android' as const, appBuild: 37 }, 'app_build'],
    ['Android with no X-App-Build', { platform: 'android' as const, appBuild: null }, 'app_build'],
  ])('%s → %s', (_label, over, reason) => {
    expect(ineligibilityReason(bounded, ctx(over))).toBe(reason);
  });

  it('a bound for another platform is ignored (missing build passes)', () => {
    const iosOnly = audience({ minBuild: { ios: 74 } });
    expect(ineligibilityReason(iosOnly, ctx({ platform: 'android', appBuild: null }))).toBeNull();
    expect(ineligibilityReason(iosOnly, ctx({ platform: 'android', appBuild: 1 }))).toBeNull();
    expect(ineligibilityReason(iosOnly, ctx({ platform: 'web', appBuild: null }))).toBeNull();
  });

  it('no platform header: no build bound applies (the platforms gate decides)', () => {
    expect(ineligibilityReason(audience({ minBuild: { ios: 74 } }), ctx({ platform: null, appBuild: null }))).toBeNull();
    expect(ineligibilityReason(audience({ platforms: ['ios'], minBuild: { ios: 74 } }), ctx({ platform: null }))).toBe('platform');
  });

  it('max bound is inclusive; min..max window', () => {
    const window = audience({ minBuild: { ios: 72 }, maxBuild: { ios: 73 } });
    expect(ineligibilityReason(window, ctx({ appBuild: 71 }))).toBe('app_build');
    expect(ineligibilityReason(window, ctx({ appBuild: 72 }))).toBeNull();
    expect(ineligibilityReason(window, ctx({ appBuild: 73 }))).toBeNull();
    expect(ineligibilityReason(window, ctx({ appBuild: 74 }))).toBe('app_build');
    expect(ineligibilityReason(audience({ maxBuild: { android: 37 } }), ctx({ platform: 'android', appBuild: null }))).toBe('app_build');
  });

  it('version gates still run first (app_version wins over app_build)', () => {
    expect(ineligibilityReason(bounded, ctx({ appVersion: '1.0.9', appBuild: 10 }))).toBe('app_version');
  });

  it('without any build bound the build is irrelevant (identical decisions)', () => {
    const live = audience({ platforms: ['ios', 'android'], minAppVersion: '1.1.0', newUsersOnly: true });
    for (const appBuild of [null, 1, 72, 74, 999_999_999]) {
      expect(ineligibilityReason(live, ctx({ appBuild }))).toBeNull();
      expect(ineligibilityReason(live, ctx({ appBuild, appVersion: '1.0.9' }))).toBe('app_version');
    }
  });
});

describe('gate matrix: appVersions allow-list', () => {
  const exact = audience({ appVersions: ['1.1.0', '1.1.2'] });

  it.each([
    ['listed', '1.1.0', null],
    ['listed, with a build suffix', '1.1.2 (80)', null],
    ['numerically equal ("1.1" = "1.1.0")', '1.1', null],
    ['not listed', '1.1.1', 'app_version'],
    ['newer, not listed', '1.2.0', 'app_version'],
    ['missing header', null, 'app_version'],
    ['garbage', 'beta', 'app_version'],
  ])('%s (%s) → %s', (_label, appVersion, reason) => {
    expect(ineligibilityReason(exact, ctx({ appVersion }))).toBe(reason);
  });

  it('combines with min/max version and build bounds (all must pass)', () => {
    const a = audience({ appVersions: ['1.1.0'], minAppVersion: '1.1.0', minBuild: { ios: 74 } });
    expect(ineligibilityReason(a, ctx({ appVersion: '1.1.0', appBuild: 74 }))).toBeNull();
    expect(ineligibilityReason(a, ctx({ appVersion: '1.1.0', appBuild: 73 }))).toBe('app_build');
  });
});

describe('sticky assignments are never re-gated', () => {
  const experiment: Experiment = {
    key: 'onboarding_paywall',
    name: 'Onboarding paywall',
    description: null,
    status: 'running',
    salt: 's',
    arms: [
      { key: 'control', name: 'Control', weight: 50, payload: {} },
      { key: 'variantA', name: 'A', weight: 50, payload: { paywall: 'hard' } },
    ],
    trafficPct: 100,
    audience: audience({ platforms: ['ios', 'android'], minBuild: { ios: 74 } }),
    fallbackArm: 'control',
    winnerArm: null,
    layer: null,
    startedAt: null,
    endedAt: null,
    createdBy: null,
    createdAt: null,
    updatedAt: null,
  };

  it('a user already in variantA keeps it after a build bound is added that they fail', () => {
    const d = decideAssignment(experiment, ctx({ appBuild: 72 }), { override: null, existing: { arm: 'variantA', reason: 'bucket' } });
    expect(d).toMatchObject({ arm: 'variantA', reason: 'bucket', enrolled: true, persist: false, ineligible: null });
  });

  it('a new user on an early build gets the fallback, not persisted (can enrol after updating)', () => {
    const d = decideAssignment(experiment, ctx({ appBuild: 72 }), { override: null, existing: null });
    expect(d).toMatchObject({ arm: 'control', reason: 'fallback', enrolled: false, persist: false, ineligible: 'app_build' });
  });
});

describe('X-App-Build parsing', () => {
  it.each([
    ['63', 63],
    [' 74 ', 74],
    ['63 (debug)', 63],
    ['38-qa', 38],
    ['999999999', 999_999_999],
    ['0', null],
    ['', null],
    [null, null],
    ['abc', null],
    ['-5', null],
    ['1.1.0', null],
    ['1234567890', null],
    ['(63)', null],
  ])('%j → %j', (raw, want) => {
    expect(parseAppBuild(raw as string | null)).toBe(want);
  });

  const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

  it('readExperimentRequestInfo reads X-App-Build (case-insensitive) next to platform/version/country', () => {
    expect(readExperimentRequestInfo(req({ 'X-App-Platform': 'iOS', 'X-App-Version': '1.1.0', 'X-App-Build': '74', 'x-vercel-ip-country': 'us' }))).toEqual({
      platform: 'ios',
      appVersion: '1.1.0',
      appBuild: 74,
      ipCountry: 'US',
    });
    expect(readExperimentRequestInfo(req({ 'X-Platform': 'android', 'X-App-Version': '1.1.0', 'x-app-build': '38 (release)' })).appBuild).toBe(38);
  });

  it('older clients without the header → appBuild null', () => {
    expect(readExperimentRequestInfo(req({ 'X-App-Platform': 'ios', 'X-App-Version': '1.0.9' })).appBuild).toBeNull();
  });
});
