import { describe, expect, it } from 'vitest';

import {
  assignArm,
  bucketOf,
  compareVersions,
  matchesAudience,
  matchesClient,
  matchesRollout,
  parseRuleRow,
  parseVersion,
  ruleActionSchema,
  ruleDefinitionSchema,
  ruleInputSchema,
  selectRules,
} from '../rules';

import { USER, makeCtx, rule, withCampaign } from './helpers';

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const USERS = Array.from({ length: 2000 }, (_, i) => uuid(i));

describe('rule schema', () => {
  it.each([
    [{ op: 'move', card: 'hydration', before: 'referral' }],
    [{ op: 'move', card: 'hydration', after: 'header' }],
    [{ op: 'move', card: 'hydration', toTop: true }],
    [{ op: 'move', card: 'hydration', toBottom: true }],
    [{ op: 'hide', card: 'pro_upsell' }],
    [{ op: 'show', card: 'pro_upsell' }],
    [{ op: 'show', card: 'future_card', version: 2 }],
    [{ op: 'variant', card: 'referral', variant: 'compact' }],
    [{ op: 'boost', card: 'charts', by: 25 }],
    [{ op: 'boost', card: 'charts', by: -40 }],
  ])('accepts %o', (action) => {
    expect(ruleActionSchema.safeParse(action).success).toBe(true);
  });

  it.each([
    [{ op: 'move', card: 'hydration' }, 'no target'],
    [{ op: 'move', card: 'hydration', before: 'a', after: 'b' }, 'two targets'],
    [{ op: 'move', card: 'hydration', toTop: false }, 'toTop false'],
    [{ op: 'move', card: 'hydration', before: 'hydration' }, 'self anchor'],
    [{ op: 'hide' }, 'missing card'],
    [{ op: 'hide', card: 'Hydration' }, 'bad card name'],
    [{ op: 'hide', card: 'x', extra: 1 }, 'unknown key'],
    [{ op: 'show', card: 'x', version: 0 }, 'version 0'],
    [{ op: 'variant', card: 'referral', variant: '' }, 'empty variant'],
    [{ op: 'variant', card: 'referral', variant: 'has space' }, 'variant with space'],
    [{ op: 'boost', card: 'charts', by: 5000 }, 'boost too big'],
    [{ op: 'boost', card: 'charts' }, 'boost without by'],
    [{ op: 'explode', card: 'charts' }, 'unknown op'],
  ])('rejects %o (%s)', (action: unknown, _why: string) => {
    expect(ruleActionSchema.safeParse(action).success).toBe(false);
  });

  it('definition needs actions or an experiment (not both), strict keys', () => {
    expect(ruleDefinitionSchema.safeParse({}).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ actions: [] }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ actions: [{ op: 'hide', card: 'charts' }], typo: 1 }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ actions: [{ op: 'hide', card: 'charts' }], audience: { prooo: true } }).success).toBe(false);
    const exp = { key: 'e', arms: [{ name: 'a', percent: 50, actions: [] }] };
    expect(ruleDefinitionSchema.safeParse({ experiment: exp }).success).toBe(true);
    expect(ruleDefinitionSchema.safeParse({ experiment: exp, actions: [{ op: 'hide', card: 'charts' }] }).success).toBe(false);
  });

  it('experiment arms: percents ≤ 100, unique names', () => {
    const arms = (a: any[]) => ruleDefinitionSchema.safeParse({ experiment: { key: 'e', arms: a } }).success;
    expect(arms([{ name: 'a', percent: 60 }, { name: 'b', percent: 50 }])).toBe(false);
    expect(arms([{ name: 'a', percent: 50 }, { name: 'a', percent: 50 }])).toBe(false);
    expect(arms([{ name: 'a', percent: 50 }, { name: 'b', percent: 50 }])).toBe(true);
    expect(arms([])).toBe(false);
  });

  it('versions and platforms are validated', () => {
    const base = { actions: [{ op: 'hide', card: 'charts' }] };
    expect(ruleDefinitionSchema.safeParse({ ...base, minAppVersion: '1.0.8' }).success).toBe(true);
    expect(ruleDefinitionSchema.safeParse({ ...base, minAppVersion: 'latest' }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ ...base, platforms: ['ios', 'windows'] }).success).toBe(false);
  });

  it('flat admin input splits into columns + definition, defaulting to disabled', () => {
    const parsed = ruleInputSchema.parse({ key: 'hide_charts', actions: [{ op: 'hide', card: 'charts' }] });
    expect(parsed).toEqual({ key: 'hide_charts', enabled: false, priority: 0, definition: { actions: [{ op: 'hide', card: 'charts' }] } });
    expect(ruleInputSchema.safeParse({ key: 'bad key!', actions: [{ op: 'hide', card: 'charts' }] }).success).toBe(false);
    const bad = ruleInputSchema.safeParse({ key: 'k', actions: [{ op: 'nope' }] });
    expect(bad.success).toBe(false);
  });

  it('parseRuleRow: valid row → rule; invalid → issues', () => {
    const ok = parseRuleRow({ key: 'k', enabled: true, priority: 5, definition: { actions: [{ op: 'hide', card: 'charts' }] } });
    expect(ok.rule).toMatchObject({ key: 'k', enabled: true, priority: 5 });
    const bad = parseRuleRow({ key: 'k', enabled: true, priority: 5, definition: { actions: [{ op: 'move', card: 'x' }] } });
    expect(bad.rule).toBeNull();
    expect(bad.issues?.[0]).toMatch(/move needs exactly one/);
    expect(parseRuleRow({ key: 'k', enabled: true, priority: 0, definition: null }).rule).toBeNull();
  });
});

describe('bucketing', () => {
  it('is deterministic and in 0–99', () => {
    for (const u of USERS.slice(0, 100)) {
      const b = bucketOf(u, 'salt');
      expect(b).toBe(bucketOf(u, 'salt'));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('pins known values (changing the hash would reshuffle live experiments)', () => {
    expect(bucketOf(USER, 'water_first')).toBe(65);
    expect(bucketOf('22222222-2222-4222-8222-222222222222', 'water_first')).toBe(75);
  });

  it('different salts give independent assignments', () => {
    const same = USERS.filter((u) => bucketOf(u, 'a') < 50 === bucketOf(u, 'b') < 50).length / USERS.length;
    expect(same).toBeGreaterThan(0.4);
    expect(same).toBeLessThan(0.6);
  });

  it('is roughly uniform', () => {
    const inHalf = USERS.filter((u) => bucketOf(u, 'water_first') < 50).length / USERS.length;
    expect(inHalf).toBeGreaterThan(0.45);
    expect(inHalf).toBeLessThan(0.55);
  });

  it('rollout percent uses bucketSalt, defaulting to the rule key', () => {
    const r = rule({ key: 'roll', actions: [{ op: 'hide', card: 'charts' }], audience: { percent: 30 } });
    for (const u of USERS.slice(0, 200)) expect(matchesRollout(r, u)).toBe(bucketOf(u, 'roll') < 30);
    const salted = rule({ key: 'roll', actions: [{ op: 'hide', card: 'charts' }], audience: { percent: 30, bucketSalt: 's2' } });
    for (const u of USERS.slice(0, 200)) expect(matchesRollout(salted, u)).toBe(bucketOf(u, 's2') < 30);
    expect(USERS.some((u) => matchesRollout(rule({ key: 'z', actions: [{ op: 'hide', card: 'x' }], audience: { percent: 0 } }), u))).toBe(false);
    expect(USERS.every((u) => matchesRollout(rule({ key: 'z', actions: [{ op: 'hide', card: 'x' }], audience: { percent: 100 } }), u))).toBe(true);
  });

  it('arms fill buckets in order; outside every arm → not enrolled', () => {
    const exp = { key: 'e', arms: [{ name: 'a', percent: 20, actions: [] }, { name: 'b', percent: 30, actions: [] }] };
    for (const u of USERS.slice(0, 300)) {
      const b = bucketOf(u, 'e');
      expect(assignArm(exp, u)?.name ?? null).toBe(b < 20 ? 'a' : b < 50 ? 'b' : null);
    }
    const salted = { ...exp, salt: 'other' };
    for (const u of USERS.slice(0, 100)) {
      const b = bucketOf(u, 'other');
      expect(assignArm(salted, u)?.name ?? null).toBe(b < 20 ? 'a' : b < 50 ? 'b' : null);
    }
  });
});

describe('versions + client gates', () => {
  it('parses and compares', () => {
    expect(parseVersion('1.0.8')).toEqual([1, 0, 8]);
    expect(parseVersion('1.0.8 (63)')).toEqual([1, 0, 8]);
    expect(parseVersion('v1.0.10-dev')).toEqual([1, 0, 10]);
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion('beta')).toBeNull();
    expect(compareVersions([1, 0, 10], [1, 0, 9])).toBe(1);
    expect(compareVersions([1, 0], [1, 0, 0])).toBe(0);
    expect(compareVersions([1, 0, 7], [1, 0, 8])).toBe(-1);
  });

  it('platforms + min/max app version; unknown never matches a gated rule', () => {
    const r = { platforms: ['ios' as const], minAppVersion: '1.0.8', maxAppVersion: '1.2' };
    expect(matchesClient(r, 'ios', '1.0.8')).toBe(true);
    expect(matchesClient(r, 'ios', '1.1.9')).toBe(true);
    expect(matchesClient(r, 'ios', '1.2.0')).toBe(true);
    expect(matchesClient(r, 'ios', '1.2.1')).toBe(false);
    expect(matchesClient(r, 'ios', '1.0.7')).toBe(false);
    expect(matchesClient(r, 'android', '1.0.8')).toBe(false);
    expect(matchesClient(r, null, '1.0.8')).toBe(false);
    expect(matchesClient(r, 'ios', null)).toBe(false);
    expect(matchesClient({}, null, null)).toBe(true);
  });
});

describe('audience filters', () => {
  const ctx = makeCtx({
    ...withCampaign('hold_the_line', 'live'),
    daysSinceSignup: 3,
    localHour: 19,
    localWeekday: 1,
    checkedInToday: false,
    streakAtRisk: true,
  });

  it.each([
    [{ pro: false }, true],
    [{ pro: true }, false],
    [{ hasCircle: true }, true],
    [{ hasCircle: false }, false],
    [{ campaignPresent: true }, true],
    [{ campaignPresent: false }, false],
    [{ campaignPhase: 'live' }, true],
    [{ campaignPhase: ['teaser', 'live'] }, true],
    [{ campaignPhase: 'teaser' }, false],
    [{ referralProgramEnabled: true }, true],
    [{ referralProgramEnabled: false }, false],
    [{ checkedInToday: false }, true],
    [{ checkedInToday: true }, false],
    [{ streakAtRisk: true }, true],
    [{ streakAtRisk: false }, false],
    [{ waterLoggedToday: false }, true],
    [{ waterLoggedToday: true }, false],
    [{ daysSinceSignupLt: 7 }, true],
    [{ daysSinceSignupLt: 3 }, false],
    [{ daysSinceSignupGte: 3 }, true],
    [{ daysSinceSignupGte: 4 }, false],
    [{ localHourGte: 18 }, true],
    [{ localHourGte: 20 }, false],
    [{ localHourLt: 20 }, true],
    [{ localHourLt: 19 }, false],
    [{ weekdays: [1, 2] }, true],
    [{ weekdays: [0, 6] }, false],
    [{ userIds: [USER] }, true],
    [{ userIds: ['99999999-9999-4999-8999-999999999999'] }, false],
    [{ pro: false, hasCircle: true, daysSinceSignupLt: 7 }, true],
    [{ pro: false, hasCircle: false }, false],
    [{}, true],
  ])('%o → %s', (audience, expected) => {
    expect(matchesAudience(audience as any, ctx)).toBe(expected);
  });

  it('undefined audience matches', () => {
    expect(matchesAudience(undefined, ctx)).toBe(true);
  });

  it('unknown context values never match a filter on them', () => {
    const unknown = makeCtx({ isPro: null, hasCircle: null, campaign: null, referralProgramEnabled: null, checkedInToday: null, waterLoggedToday: null, daysSinceSignup: null });
    for (const a of [{ pro: false }, { pro: true }, { hasCircle: true }, { campaignPresent: false }, { campaignPhase: 'live' }, { referralProgramEnabled: true }, { checkedInToday: false }, { waterLoggedToday: false }, { daysSinceSignupLt: 99 }, { daysSinceSignupGte: 0 }]) {
      expect(matchesAudience(a as any, unknown)).toBe(false);
    }
  });

  it('campaignPhase never matches when no campaign is present', () => {
    expect(matchesAudience({ campaignPhase: 'live' }, makeCtx())).toBe(false);
  });
});

describe('selectRules', () => {
  const hide = (card: string) => [{ op: 'hide', card }];

  it('skips disabled rules unless includeDisabled', () => {
    const rules = [rule({ key: 'off', enabled: false, actions: hide('charts') })];
    expect(selectRules(rules, makeCtx())).toEqual([]);
    expect(selectRules(rules, makeCtx(), { includeDisabled: true }).map((r) => r.key)).toEqual(['off']);
  });

  it('applies in ascending priority, then key', () => {
    const rules = [
      rule({ key: 'b', priority: 5, actions: hide('charts') }),
      rule({ key: 'a', priority: 5, actions: hide('charts') }),
      rule({ key: 'z', priority: -1, actions: hide('charts') }),
      rule({ key: 'top', priority: 50, actions: hide('charts'), layoutKey: 'top-v2' }),
    ];
    const applied = selectRules(rules, makeCtx());
    expect(applied.map((r) => r.key)).toEqual(['z', 'a', 'b', 'top']);
    expect(applied.map((r) => r.layoutSegment)).toEqual(['z', 'a', 'b', 'top-v2']);
  });

  it('filters on platform, version and audience', () => {
    const rules = [
      rule({ key: 'android_only', platforms: ['android'], actions: hide('charts') }),
      rule({ key: 'new_apps', minAppVersion: '1.0.9', actions: hide('charts') }),
      rule({ key: 'pros', audience: { pro: true }, actions: hide('charts') }),
      rule({ key: 'everyone', actions: hide('charts') }),
    ];
    expect(selectRules(rules, makeCtx()).map((r) => r.key)).toEqual(['everyone']);
  });

  it('reports the experiment arm and the arm actions', () => {
    const exp = rule({
      key: 'exp_rule',
      experiment: { key: 'water_first', arms: [{ name: 'treatment', percent: 50, actions: hide('charts') }, { name: 'control', percent: 50 }] },
    });
    for (const u of USERS.slice(0, 50)) {
      const [applied] = selectRules([exp], makeCtx({ userId: u }));
      const arm = bucketOf(u, 'water_first') < 50 ? 'treatment' : 'control';
      expect(applied.experiment).toEqual({ key: 'water_first', arm });
      expect(applied.layoutSegment).toBe(`water_first.${arm}`);
      expect(applied.actions).toEqual(arm === 'treatment' ? hide('charts') : []);
    }
  });

  it('users outside every arm are not enrolled', () => {
    const exp = rule({ key: 'e', experiment: { key: 'e', arms: [{ name: 'a', percent: 10 }] } });
    const out = USERS.find((u) => bucketOf(u, 'e') >= 10)!;
    expect(selectRules([exp], makeCtx({ userId: out }))).toEqual([]);
  });

  it('one experiment per response: highest priority wins, others are skipped; plain rules still apply', () => {
    const lo = rule({ key: 'lo', priority: 1, experiment: { key: 'lo', arms: [{ name: 'all', percent: 100 }] } });
    const hi = rule({ key: 'hi', priority: 9, experiment: { key: 'hi', arms: [{ name: 'all', percent: 100 }] } });
    const plain = rule({ key: 'plain', priority: 5, actions: hide('charts') });
    const applied = selectRules([lo, hi, plain], makeCtx());
    expect(applied.map((r) => r.key)).toEqual(['plain', 'hi']);
    expect(applied.find((r) => r.experiment)?.experiment).toEqual({ key: 'hi', arm: 'all' });
  });

  it('falls through to a lower experiment when not enrolled in the higher one', () => {
    const hi = rule({ key: 'hi', priority: 9, experiment: { key: 'hi', arms: [{ name: 'a', percent: 10 }] } });
    const lo = rule({ key: 'lo', priority: 1, experiment: { key: 'lo', arms: [{ name: 'b', percent: 100 }] } });
    const out = USERS.find((u) => bucketOf(u, 'hi') >= 10)!;
    expect(selectRules([hi, lo], makeCtx({ userId: out })).map((r) => r.experiment)).toEqual([{ key: 'lo', arm: 'b' }]);
  });
});
