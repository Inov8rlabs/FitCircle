import { describe, expect, it } from 'vitest';

import {
  applyChanges,
  diffRulesets,
  draftPreviewBodySchema,
  publishBodySchema,
  resolveDraftRuleset,
  rowToFlat,
  rulesetVersion,
  stableStringify,
  toFeedRules,
  type FlatRule,
} from '../ruleset';

const GOALS: FlatRule = { key: 'new_user_goals_first', enabled: true, priority: 10, audience: { daysSinceSignupLt: 7 }, actions: [{ op: 'move', card: 'daily_goals', after: 'header' }] };
const CHARTS: FlatRule = { key: 'hide_charts', enabled: false, priority: 0, platforms: ['android'], actions: [{ op: 'hide', card: 'charts' }] };

describe('ruleset version', () => {
  it('is a content hash: independent of key order, row order and ids', () => {
    const a = rulesetVersion([GOALS, CHARTS]);
    const reordered = rulesetVersion([
      { priority: 0, actions: [{ card: 'charts', op: 'hide' }], platforms: ['android'], enabled: false, key: 'hide_charts' },
      { ...GOALS },
    ]);
    expect(a).toMatch(/^r1-[0-9a-f]{16}$/);
    expect(reordered).toBe(a);
    expect(rulesetVersion([GOALS, { ...CHARTS, enabled: true }])).not.toBe(a);
    expect(rulesetVersion([])).toBe(rulesetVersion([]));
  });

  it('rowToFlat spreads the stored definition and keeps invalid rows as-is', () => {
    expect(rowToFlat({ key: 'k', enabled: true, priority: 3, definition: { actions: [{ op: 'teleport' }] } })).toEqual({ key: 'k', enabled: true, priority: 3, actions: [{ op: 'teleport' }] });
    expect(rowToFlat({ key: 'k', enabled: false, priority: 0, definition: null })).toEqual({ key: 'k', enabled: false, priority: 0 });
  });

  it('stableStringify sorts nested keys and drops undefined', () => {
    expect(stableStringify({ b: 1, a: { d: [2, { z: 1, y: undefined }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"z":1}]},"b":1}');
  });
});

describe('applyChanges', () => {
  it('creates, updates, enables, disables and deletes — validating with the production schema', () => {
    const { rules, issues } = applyChanges([GOALS, CHARTS], [
      { op: 'enable', key: 'hide_charts' },
      { op: 'update', key: 'new_user_goals_first', rule: { ...GOALS, priority: 20 } },
      { op: 'create', rule: { key: 'campaign_low', actions: [{ op: 'move', card: 'campaign', after: 'vitals' }] } },
    ]);
    expect(issues).toEqual([]);
    expect(rules.find((r) => r.key === 'hide_charts')?.enabled).toBe(true);
    expect(rules.find((r) => r.key === 'new_user_goals_first')?.priority).toBe(20);
    // Defaults are filled in by the validator (new rules disabled, priority 0).
    expect(rules.find((r) => r.key === 'campaign_low')).toMatchObject({ enabled: false, priority: 0 });
    expect(applyChanges([GOALS], [{ op: 'delete', key: GOALS.key }]).rules).toEqual([]);
  });

  it('reports every problem with the rule key', () => {
    const { issues } = applyChanges([GOALS], [
      { op: 'create', rule: { key: 'new_user_goals_first', actions: [{ op: 'hide', card: 'charts' }] } },
      { op: 'update', key: 'missing', rule: { key: 'missing', actions: [{ op: 'hide', card: 'charts' }] } },
      { op: 'create', rule: { key: 'bad_move', actions: [{ op: 'move', card: 'hydration' }] } },
      { op: 'enable', key: 'nope' },
    ]);
    expect(issues.map((i) => i.key)).toEqual(['new_user_goals_first', 'missing', 'bad_move', 'nope']);
    expect(issues[2].message).toMatch(/exactly one/);
  });

  it('refuses a key used twice in one changeset, renames, and enabling an invalid stored rule', () => {
    const legacy: FlatRule = { key: 'legacy', enabled: false, priority: 0, actions: [{ op: 'teleport' }] };
    expect(applyChanges([GOALS], [{ op: 'disable', key: GOALS.key }, { op: 'delete', key: GOALS.key }]).issues[0].message).toMatch(/more than one/);
    expect(applyChanges([GOALS], [{ op: 'update', key: GOALS.key, rule: { ...GOALS, key: 'renamed' } }]).issues[0].message).toMatch(/renaming/);
    expect(applyChanges([legacy], [{ op: 'enable', key: 'legacy' }]).issues[0].message).toMatch(/no longer validates/);
  });
});

describe('diffRulesets', () => {
  it('produces the minimal changeset and round-trips through applyChanges', () => {
    const after: FlatRule[] = [{ ...GOALS, priority: 11 }, { ...CHARTS, enabled: true }, { key: 'x_new', enabled: true, priority: 1, actions: [{ op: 'hide', card: 'vitals' }] }];
    const before: FlatRule[] = [GOALS, CHARTS, { key: 'a_gone', enabled: true, priority: 0, actions: [{ op: 'hide', card: 'body_comp' }] }];
    const changes = diffRulesets(before, after);
    expect(changes.map((c) => `${c.op}:${c.op === 'create' ? c.rule.key : c.key}`)).toEqual(['delete:a_gone', 'enable:hide_charts', 'update:new_user_goals_first', 'create:x_new']);
    const applied = applyChanges(before, changes);
    expect(applied.issues).toEqual([]);
    expect(rulesetVersion(applied.rules)).toBe(rulesetVersion(after));
    expect(diffRulesets(after, after)).toEqual([]);
  });
});

describe('resolveDraftRuleset', () => {
  it('validates each draft rule, keeps an unchanged invalid stored rule, and reports duplicates', () => {
    const legacy: FlatRule = { key: 'legacy', enabled: false, priority: 0, actions: [{ op: 'teleport' }] };
    const r = resolveDraftRuleset([GOALS, legacy], [
      { ...GOALS, priority: 5 },
      { ...legacy },
      { key: 'broken', actions: [] },
      { key: 'broken', actions: [{ op: 'hide', card: 'charts' }] },
    ]);
    expect(r.issues.map((i) => [i.key, i.message])).toEqual([
      ['broken', 'a rule needs actions or an experiment'],
      ['broken', 'duplicate key "broken"'],
    ]);
    expect(r.rules.map((x) => x.key)).toEqual(['new_user_goals_first', 'legacy']);
    expect(r.changes).toEqual([{ op: 'update', key: 'new_user_goals_first', rule: { ...GOALS, priority: 5 } }]);
  });

  it('toFeedRules drops invalid rules like production does', () => {
    expect(toFeedRules([GOALS, { key: 'legacy', enabled: true, priority: 0, actions: [{ op: 'teleport' }] }]).map((r) => r.key)).toEqual(['new_user_goals_first']);
  });
});

describe('request bodies', () => {
  it('publish requires a baseVersion, a summary and at least one change', () => {
    const v = rulesetVersion([]);
    expect(publishBodySchema.safeParse({ baseVersion: v, changes: [{ op: 'enable', key: 'a' }], summary: 'Enable a' }).success).toBe(true);
    expect(publishBodySchema.safeParse({ baseVersion: 'latest', changes: [{ op: 'enable', key: 'a' }], summary: 'x' }).success).toBe(false);
    expect(publishBodySchema.safeParse({ baseVersion: v, changes: [], summary: 'x' }).success).toBe(false);
    expect(publishBodySchema.safeParse({ baseVersion: v, changes: [{ op: 'enable', key: 'a' }], summary: '  ' }).success).toBe(false);
    expect(publishBodySchema.safeParse({ baseVersion: v, changes: [{ op: 'enable', key: 'a' }], summary: 'x', extra: 1 }).success).toBe(false);
  });

  it('draft preview takes one subject and one draft form', () => {
    expect(draftPreviewBodySchema.safeParse({ platform: 'ios', version: '1.1.0' }).success).toBe(true);
    expect(draftPreviewBodySchema.safeParse({ platform: 'ios', version: '1.1.0', persona: 'typical', userId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false);
    expect(draftPreviewBodySchema.safeParse({ platform: 'ios', version: '1.1.0', draft: { rules: [], changes: [] } }).success).toBe(false);
    expect(draftPreviewBodySchema.safeParse({ platform: 'blackberry', version: '1.1.0' }).success).toBe(false);
  });
});
