/** Remote config: pure resolution order, bounds, and every audience field (TRIAL_FIRST_SPEC §6). */
import { describe, expect, it } from 'vitest';

import { bucketOf } from '../../experiments/bucket';
import { audienceMismatch, audienceSchema, type AudienceFacts } from '../audience';
import { REMOTE_CONFIG_REGISTRY, validValue } from '../registry';
import { parseRules, resolveWithFacts, type ConfigSnapshot, type RuleRow } from '../resolve';

const USER = '11111111-2222-3333-4444-555555555555';
const NOW = new Date('2026-11-06T12:00:00Z');
const KEY = 'free_food_ai_analyses_total' as const;

const facts = (over: Partial<AudienceFacts> = {}): AudienceFacts => ({
  userId: USER,
  now: NOW,
  platform: 'ios',
  appVersion: '1.2.0',
  country: 'US',
  channel: 'apple_ads',
  signupAt: '2026-11-01T00:00:00Z',
  experimentArms: {},
  ...over,
});

let n = 0;
const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  config_key: KEY,
  name: `r${n}`,
  enabled: true,
  priority: 0,
  audience: {},
  value: 7,
  created_by: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_by: null,
  updated_at: '2026-11-01T00:00:00Z',
  ...over,
});

const snap = (rules: RuleRow[], defaults: Record<string, unknown> = {}): ConfigSnapshot => ({
  rules: parseRules(rules),
  defaults: new Map(Object.entries(defaults).map(([k, v]) => [k, { config_key: k, value: v, updated_by: null, updated_at: '2026-11-01T00:00:00Z' }])),
});

describe('registry', () => {
  it('ships the two free-tier keys with the agreed defaults and bounds', () => {
    expect(REMOTE_CONFIG_REGISTRY.free_food_ai_analyses_total).toMatchObject({ type: 'int', default: 5, min: 0, max: 1000 });
    expect(REMOTE_CONFIG_REGISTRY.free_fitzy_messages_per_day).toMatchObject({ type: 'int', default: 0, min: 0, max: 200 });
  });

  it('bounds: integers within [min, max] only', () => {
    expect(validValue(KEY, 0)).toBe(0);
    expect(validValue(KEY, 1000)).toBe(1000);
    for (const bad of [-1, 1001, 2.5, '5', null, undefined, {}]) expect(validValue(KEY, bad)).toBeNull();
    expect(validValue('free_fitzy_messages_per_day', 201)).toBeNull();
  });
});

describe('resolution order', () => {
  it('code default when nothing is configured', () => {
    expect(resolveWithFacts(snap([]), KEY, facts())).toEqual({ value: 5, source: 'code' });
  });

  it('admin default beats code; an invalid default falls back to code', () => {
    expect(resolveWithFacts(snap([], { [KEY]: 9 }), KEY, facts())).toEqual({ value: 9, source: 'default' });
    expect(resolveWithFacts(snap([], { [KEY]: 5000 }), KEY, facts())).toEqual({ value: 5, source: 'code' });
  });

  it('highest-priority matching enabled rule wins; ties → oldest', () => {
    const low = rule({ priority: 1, value: 11 });
    const high = rule({ priority: 5, value: 22 });
    const tieOld = rule({ priority: 9, value: 33, created_at: '2026-10-01T00:00:00Z' });
    const tieNew = rule({ priority: 9, value: 44, created_at: '2026-10-02T00:00:00Z' });
    const disabled = rule({ priority: 100, value: 55, enabled: false });
    const otherKey = rule({ priority: 100, value: 3, config_key: 'free_fitzy_messages_per_day' });
    const r = resolveWithFacts(snap([low, high, tieNew, tieOld, disabled, otherKey], { [KEY]: 9 }), KEY, facts());
    expect(r).toEqual({ value: 33, source: 'rule', ruleId: tieOld.id, ruleName: tieOld.name });
  });

  it('non-matching rules are skipped; an invalid rule value falls through to the next source', () => {
    const nomatch = rule({ priority: 10, audience: { platforms: ['android'] }, value: 1 });
    const invalid = rule({ priority: 5, value: -3 });
    const ok = rule({ priority: 1, value: 2 });
    expect(resolveWithFacts(snap([nomatch, invalid, ok]), KEY, facts())).toMatchObject({ value: 2, ruleId: ok.id });
    expect(resolveWithFacts(snap([nomatch, invalid], { [KEY]: 8 }), KEY, facts())).toEqual({ value: 8, source: 'default' });
  });

  it('a rule with an invalid stored audience is ignored', () => {
    const broken = rule({ priority: 50, audience: { countries: ['USA'] }, value: 1 });
    expect(resolveWithFacts(snap([broken]), KEY, facts())).toEqual({ value: 5, source: 'code' });
  });
});

describe('audience fields (all AND; unknown never matches)', () => {
  const m = (a: unknown, f: Partial<AudienceFacts> = {}) => audienceMismatch(audienceSchema.parse(a), facts(f), 'rule-1');

  it('empty audience matches everyone', () => expect(m({})).toBeNull());

  it('platforms', () => {
    expect(m({ platforms: ['ios'] })).toBeNull();
    expect(m({ platforms: ['android'] })).toBe('platforms');
    expect(m({ platforms: ['ios'] }, { platform: null })).toBe('platforms');
  });

  it('appVersionGte / appVersionLt', () => {
    expect(m({ appVersionGte: '1.2.0' })).toBeNull();
    expect(m({ appVersionGte: '1.2.1' })).toBe('appVersionGte');
    expect(m({ appVersionLt: '1.2.0' })).toBe('appVersionLt');
    expect(m({ appVersionLt: '1.10.0' })).toBeNull();
    expect(m({ appVersionGte: '1.0' }, { appVersion: null })).toBe('appVersionGte');
  });

  it('countries (case-insensitive ISO2)', () => {
    expect(m({ countries: ['us', 'GB'] })).toBeNull();
    expect(m({ countries: ['IN'] })).toBe('countries');
    expect(m({ countries: ['US'] }, { country: null })).toBe('countries');
  });

  it('channels', () => {
    expect(m({ channels: ['apple_ads'] })).toBeNull();
    expect(m({ channels: ['organic'] })).toBe('channels');
    expect(m({ channels: ['apple_ads'] }, { channel: null })).toBe('channels');
  });

  it('signupAfter / signupBefore', () => {
    expect(m({ signupAfter: '2026-10-31' })).toBeNull();
    expect(m({ signupAfter: '2026-11-02' })).toBe('signupAfter');
    expect(m({ signupBefore: '2026-11-02' })).toBeNull();
    expect(m({ signupBefore: '2026-11-01' })).toBe('signupBefore');
    expect(m({ signupAfter: '2026-01-01' }, { signupAt: null })).toBe('signupAfter');
  });

  it('daysSinceSignupGte / Lt (signup 5.5 days ago → 5)', () => {
    expect(m({ daysSinceSignupGte: 5 })).toBeNull();
    expect(m({ daysSinceSignupGte: 6 })).toBe('daysSinceSignupGte');
    expect(m({ daysSinceSignupLt: 6 })).toBeNull();
    expect(m({ daysSinceSignupLt: 5 })).toBe('daysSinceSignupLt');
  });

  it('percent + bucketSalt (default salt = rule id)', () => {
    const b = bucketOf(USER, 'rule-1');
    expect(m({ percent: b + 1 })).toBeNull();
    expect(m({ percent: b })).toBe('percent');
    const b2 = bucketOf(USER, 'my-salt');
    expect(m({ percent: b2 + 1, bucketSalt: 'my-salt' })).toBeNull();
    expect(m({ percent: 0 })).toBe('percent');
    expect(m({ percent: 100 })).toBeNull();
  });

  it('experiment {key, arms} uses the stored assignment', () => {
    expect(m({ experiment: { key: 'onboarding_paywall', arms: ['hard'] } }, { experimentArms: { onboarding_paywall: 'hard' } })).toBeNull();
    expect(m({ experiment: { key: 'onboarding_paywall', arms: ['hard'] } }, { experimentArms: { onboarding_paywall: 'soft' } })).toBe('experiment');
    expect(m({ experiment: { key: 'onboarding_paywall', arms: ['hard'] } })).toBe('experiment'); // not assigned
  });

  it('userIds / excludeUserIds (exclusion wins)', () => {
    expect(m({ userIds: [USER] })).toBeNull();
    expect(m({ userIds: ['99999999-2222-3333-4444-555555555555'] })).toBe('userIds');
    expect(m({ userIds: [USER], excludeUserIds: [USER] })).toBe('excludeUserIds');
  });

  it('conditions AND together', () => {
    expect(m({ platforms: ['ios'], countries: ['US'], channels: ['apple_ads'] })).toBeNull();
    expect(m({ platforms: ['ios'], countries: ['GB'] })).toBe('countries');
  });

  it('schema rejects unknown fields and bad values with paths', () => {
    const bad = audienceSchema.safeParse({ platforms: ['windows'], countries: ['USA'], percent: 101, nope: 1 });
    expect(bad.success).toBe(false);
    const paths = (bad as any).error.issues.map((i: any) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['platforms.0', 'countries.0', 'percent']));
  });
});
