import { describe, expect, it } from 'vitest';

import { buildCandidates, parseClientCards } from '../candidates';
import { DEFAULT_ORDER } from '../catalog';
import { DefaultRanker, ModelRanker, RulesRanker, applyMove, buildFeatureVector, FEATURE_VERSION, type ScoringModel } from '../rankers';
import { bucketOf } from '../rules';
import type { FeedContext } from '../types';

import { SPEC_SUPPORT, makeCtx, rule, types, withCampaign } from './helpers';

const rank = (ranker: { rank: (i: any) => any }, ctx: FeedContext | null = makeCtx(), support = SPEC_SUPPORT) =>
  ranker.rank({ candidates: buildCandidates(ctx, support), ctx, support });

const NO_CAMPAIGN = DEFAULT_ORDER.filter((t) => t !== 'campaign');

const rulesRank = (rules: any[], ctx: FeedContext = makeCtx(), support = SPEC_SUPPORT) => rank(new RulesRanker(rules), ctx, support);

describe('DefaultRanker', () => {
  it('is the spec §4 default order (no campaign)', () => {
    const out = rank(new DefaultRanker(), makeCtx());
    expect(types(out.cards)).toEqual(NO_CAMPAIGN);
    expect(out).toMatchObject({ layoutSegments: [], experiment: null, appliedRules: [] });
  });

  it('campaign present → referral steps below progress (1.0.7 behaviour)', () => {
    const t = types(rank(new DefaultRanker(), makeCtx(withCampaign())).cards);
    expect(t.indexOf('referral')).toBe(t.indexOf('progress') + 1);
    expect(t.indexOf('campaign')).toBeLessThan(t.indexOf('hydration'));
  });

  it('scores strictly decrease (deterministic ordering)', () => {
    const scores = rank(new DefaultRanker()).cards.map((c: any) => c.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
  });
});

describe('RulesRanker', () => {
  const free = makeCtx();

  it('no rules / no context → default', () => {
    expect(types(rank(new RulesRanker([]), free).cards)).toEqual(NO_CAMPAIGN);
    expect(types(rank(new RulesRanker([rule({ key: 'x', actions: [{ op: 'hide', card: 'charts' }] })]), null).cards)).toEqual(types(rank(new DefaultRanker(), null).cards));
  });

  it('move before / after / toTop / toBottom', () => {
    const t = (action: any) => types(rulesRank([rule({ key: 'm', actions: [action] })], free).cards);
    const before = t({ op: 'move', card: 'charts', before: 'hydration' });
    expect(before.indexOf('charts')).toBe(before.indexOf('hydration') - 1);
    const after = t({ op: 'move', card: 'charts', after: 'header' });
    expect(after.indexOf('charts')).toBe(after.indexOf('header') + 1);
    expect(t({ op: 'move', card: 'charts', toTop: true })[0]).toBe('charts');
    expect(t({ op: 'move', card: 'header', toBottom: true }).at(-1)).toBe('header');
  });

  it('move with a missing card or anchor is a no-op', () => {
    const base = types(rulesRank([], free).cards);
    expect(types(rulesRank([rule({ key: 'm', actions: [{ op: 'move', card: 'nope', toTop: true }] })], free).cards)).toEqual(base);
    expect(types(rulesRank([rule({ key: 'm', actions: [{ op: 'move', card: 'charts', after: 'nope' }] })], free).cards)).toEqual(base);
  });

  it('hide removes; show restores a hidden or hint-suppressed card', () => {
    const hidden = rulesRank([rule({ key: 'h', actions: [{ op: 'hide', card: 'charts' }] })], free);
    expect(types(hidden.cards)).not.toContain('charts');
    expect(hidden.appliedRules).toEqual(['h']);

    const restored = rulesRank([rule({ key: 'h', priority: 1, actions: [{ op: 'hide', card: 'charts' }] }), rule({ key: 's', priority: 2, actions: [{ op: 'show', card: 'charts' }] })], free);
    expect(types(restored.cards)).toContain('charts');

    const pro = makeCtx({ isPro: true });
    expect(types(rulesRank([], pro).cards)).not.toContain('pro_upsell');
    expect(types(rulesRank([rule({ key: 's', actions: [{ op: 'show', card: 'pro_upsell' }] })], pro).cards)).toContain('pro_upsell');
  });

  it('show never adds a card the client did not declare', () => {
    const support = parseClientCards('header@1,hydration@1');
    const out = rulesRank([rule({ key: 's', actions: [{ op: 'show', card: 'charts' }, { op: 'show', card: 'future_card', version: 1 }] })], free, support);
    expect(types(out.cards)).toEqual(['header', 'hydration']);
  });

  it('show introduces a future (non-catalog) type only for clients declaring that version', () => {
    const r = [rule({ key: 's', actions: [{ op: 'show', card: 'future_card', version: 2 }] })];
    expect(types(rulesRank(r, free, parseClientCards('header@1,future_card@2')).cards)).toEqual(['header', 'future_card']);
    expect(types(rulesRank(r, free, parseClientCards('header@1,future_card@1')).cards)).toEqual(['header']);
    const noVersion = [rule({ key: 's', actions: [{ op: 'show', card: 'future_card' }] })];
    expect(types(rulesRank(noVersion, free, parseClientCards('header@1,future_card@9')).cards)).toEqual(['header']);
  });

  it('variant sets the variant (last rule wins)', () => {
    const out = rulesRank(
      [rule({ key: 'a', priority: 1, actions: [{ op: 'variant', card: 'referral', variant: 'compact' }] }), rule({ key: 'b', priority: 2, actions: [{ op: 'variant', card: 'referral', variant: 'hero' }] })],
      free
    );
    expect(out.cards.find((c: any) => c.type === 'referral').variant).toBe('hero');
    expect(out.cards.find((c: any) => c.type === 'hydration').variant).toBeUndefined();
  });

  it('boost: +10 = one slot up, ties broken toward the boosted card; negative sinks; boosts add up', () => {
    const t = (rules: any[]) => types(rulesRank(rules, free).cards);
    const base = t([]);
    const up1 = t([rule({ key: 'b', actions: [{ op: 'boost', card: 'charts', by: 10 }] })]);
    expect(up1.indexOf('charts')).toBe(base.indexOf('charts') - 1);
    const up3 = t([rule({ key: 'a', actions: [{ op: 'boost', card: 'charts', by: 10 }] }), rule({ key: 'b', actions: [{ op: 'boost', card: 'charts', by: 20 }] })]);
    expect(up3.indexOf('charts')).toBe(base.indexOf('charts') - 3);
    const sink = t([rule({ key: 'b', actions: [{ op: 'boost', card: 'hydration', by: -1000 }] })]);
    expect(sink.at(-1)).toBe('hydration');
  });

  it('moves apply after scoring, so a move beats a boost', () => {
    const out = types(
      rulesRank([rule({ key: 'a', priority: 9, actions: [{ op: 'boost', card: 'charts', by: 1000 }] }), rule({ key: 'b', priority: 1, actions: [{ op: 'move', card: 'charts', toBottom: true }] })], free).cards
    );
    expect(out.at(-1)).toBe('charts');
  });

  it('higher priority applies later and wins conflicting moves', () => {
    const out = types(
      rulesRank([rule({ key: 'hi', priority: 10, actions: [{ op: 'move', card: 'charts', toTop: true }] }), rule({ key: 'lo', priority: 1, actions: [{ op: 'move', card: 'charts', toBottom: true }] })], free).cards
    );
    expect(out[0]).toBe('charts');
  });

  it('hiding the campaign restores referral to its default slot', () => {
    const t = types(rulesRank([rule({ key: 'h', actions: [{ op: 'hide', card: 'campaign' }] })], makeCtx(withCampaign())).cards);
    expect(t.indexOf('referral')).toBe(t.indexOf('hydration') + 1);
  });

  it('reports layout segments and the experiment', () => {
    const exp = rule({ key: 'water_first', priority: 100, experiment: { key: 'water_first', arms: [{ name: 'treatment', percent: 50, actions: [{ op: 'move', card: 'hydration', after: 'header' }] }, { name: 'control', percent: 50 }] } });
    const plain = rule({ key: 'hide_charts', actions: [{ op: 'hide', card: 'charts' }] });
    const user = Array.from({ length: 500 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).find((u) => bucketOf(u, 'water_first') < 50)!;
    const out = rulesRank([exp, plain], makeCtx({ userId: user }));
    expect(out.experiment).toEqual({ key: 'water_first', arm: 'treatment' });
    expect(out.layoutSegments).toEqual(['hide_charts', 'water_first.treatment']);
    expect(types(out.cards).slice(1, 3)).toEqual(['header', 'hydration']);
  });

  it('applyMove keeps the list when the card is absent', () => {
    const cards = [{ id: 'a', type: 'a', version: 1, score: 1, boost: 0 }];
    expect(applyMove(cards, { op: 'move', card: 'zz', toTop: true })).toBe(cards);
  });
});

describe('ModelRanker (stub)', () => {
  it('builds a coarse, deterministic feature vector', () => {
    const ctx = makeCtx({ isPro: null, localHour: 19 });
    const card = { id: 'hydration', type: 'hydration', version: 1 };
    const f = buildFeatureVector(card, ctx);
    expect(f).toEqual(buildFeatureVector(card, ctx));
    expect(f).toMatchObject({ feature_version: FEATURE_VERSION, card_hydration: 1, is_promo: 0, is_pro: -1, is_evening: 1, platform_ios: 1, has_circle: 1 });
    expect(buildFeatureVector({ id: 'x', type: 'future_card', version: 1 }, ctx).card_other).toBe(1);
    for (const v of Object.values(f)) expect(Number.isFinite(v)).toBe(true);
  });

  it('weight 0 reproduces the default; a model can reorder', () => {
    const charts: ScoringModel = { id: 'charts_lover', score: (fs) => fs.map((f) => (f.card_charts ? 1 : 0)) };
    expect(types(rank(new ModelRanker(charts, 0), makeCtx()).cards)).toEqual(NO_CAMPAIGN);
    const out = rank(new ModelRanker(charts, 0.9), makeCtx());
    expect(out.cards[0].type).toBe('charts');
    expect(out.layoutSegments).toEqual(['model.charts_lover']);
  });

  it('non-finite model scores are treated as 0', () => {
    const broken: ScoringModel = { id: 'nan', score: (fs) => fs.map(() => NaN) };
    expect(types(rank(new ModelRanker(broken, 0.5), makeCtx()).cards)).toEqual(NO_CAMPAIGN);
  });
});
