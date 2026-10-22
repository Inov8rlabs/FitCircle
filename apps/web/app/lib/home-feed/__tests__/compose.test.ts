import { describe, expect, it } from 'vitest';

import { parseClientCards } from '../candidates';
import { DEFAULT_LAYOUT_KEY, FEED_TTL_SECONDS } from '../catalog';
import { composeFeed } from '../compose';
import { areRulesEnabled, isFeedEnabled } from '../config';
import { violations } from '../guardrails';
import type { Ranker } from '../rankers';
import { bucketOf } from '../rules';

import { SPEC_SUPPORT, makeCtx, rule, types, withCampaign } from './helpers';

const NOW = new Date('2026-10-22T16:00:00Z');
const ids = (r: ReturnType<typeof composeFeed>) => r.response.cards.map((c) => c.id);

describe('composeFeed', () => {
  it('produces the schema-1 envelope', () => {
    const r = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx(), now: NOW, decisionId: 'd-1' });
    expect(r.response).toMatchObject({
      schema: 1,
      decision_id: 'd-1',
      generated_at: '2026-10-22T16:00:00.000Z',
      ttl_seconds: FEED_TTL_SECONDS,
      layout_key: DEFAULT_LAYOUT_KEY,
      experiment: null,
    });
    expect(r.response.decision_id).toBe('d-1');
    expect(composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx() }).response.decision_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('default layout, no campaign (free user)', () => {
    expect(ids(composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx() }))).toEqual([
      'offline_banner', 'header', 'health_sync_banner', 'hydration', 'referral', 'streak_warning', 'pro_upsell',
      'daily_goals', 'fitzy_focus', 'progress', 'vitals', 'body_comp', 'past_date_log', 'native_ad', 'charts',
    ]);
  });

  it('default layout with a campaign: referral after progress, hydration directly above it, header first', () => {
    const r = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx(withCampaign()) });
    expect(ids(r)).toEqual([
      'offline_banner', 'header', 'health_sync_banner', 'campaign:hold_the_line', 'streak_warning', 'pro_upsell',
      'daily_goals', 'fitzy_focus', 'progress', 'hydration', 'referral', 'vitals', 'body_comp', 'past_date_log', 'native_ad', 'charts',
    ]);
    expect(r.response.cards[3]).toEqual({ id: 'campaign:hold_the_line', type: 'campaign', version: 1, props: { slug: 'hold_the_line' } });
  });

  it('Pro user: no upsell, no ad', () => {
    const t = types(composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx({ isPro: true }) }).response.cards);
    expect(t).not.toContain('pro_upsell');
    expect(t).not.toContain('native_ad');
  });

  it('only returns cards the client declared (type + version)', () => {
    const support = parseClientCards('header@1,hydration@1,referral@1,charts@1');
    const r = composeFeed({ support, ctx: makeCtx() });
    expect(types(r.response.cards)).toEqual(['header', 'hydration', 'referral', 'charts']);
  });

  it('a client declaring an older version than the server card does not get it', () => {
    // Simulate a v2 server card by a ranker that emits it.
    const v2: Ranker = {
      name: 'v2',
      rank: ({ candidates }) => ({
        cards: candidates.eligible.map((c, i) => ({ ...c, version: c.type === 'hydration' ? 2 : c.version, score: -i, boost: 0 })),
        layoutSegments: [],
        experiment: null,
        appliedRules: [],
      }),
    };
    const old = composeFeed({ support: parseClientCards('header@1,hydration@1'), ctx: makeCtx(), ranker: v2 });
    expect(types(old.response.cards)).toEqual(['header']);
    expect(old.trace.droppedUnsupported).toEqual(['hydration']);
    const upgraded = composeFeed({ support: parseClientCards('header@1,hydration@3'), ctx: makeCtx(), ranker: v2 });
    expect(upgraded.response.cards).toContainEqual({ id: 'hydration', type: 'hydration', version: 2 });
  });

  it('an unknown card type in rules is never returned to a client that did not declare it', () => {
    const rules = [
      rule({ key: 'future', actions: [{ op: 'show', card: 'future_card', version: 1 }, { op: 'move', card: 'future_card', toTop: true }, { op: 'variant', card: 'future_card', variant: 'big' }] }),
    ];
    const r = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx(), rules });
    expect(types(r.response.cards)).not.toContain('future_card');
    expect(r.trace.appliedRules).toEqual(['future']);
    // …and is returned (after the header) to a client that declared it.
    const declared = composeFeed({ support: parseClientCards(`${[...SPEC_SUPPORT.keys()].map((k) => `${k}@1`).join(',')},future_card@1`), ctx: makeCtx(), rules });
    expect(declared.response.cards.slice(0, 3).map((c) => c.type)).toEqual(['offline_banner', 'header', 'future_card']);
    expect(declared.response.cards[2]).toEqual({ id: 'future_card', type: 'future_card', version: 1, variant: 'big' });
  });

  it('a misbehaving ranker cannot leak undeclared cards or break guardrails', () => {
    const evil: Ranker = {
      name: 'evil',
      rank: () => ({
        cards: ['native_ad', 'pro_upsell', 'referral', 'campaign', 'secret_card', 'header', 'header', 'charts', 'vitals', 'hydration'].map((t, i) => ({ id: t, type: t, version: 1, score: -i, boost: 0 })),
        layoutSegments: ['evil'],
        experiment: null,
        appliedRules: [],
      }),
    };
    const r = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx(), ranker: evil });
    const out = r.response.cards;
    expect(types(out)).not.toContain('secret_card');
    expect(out[0].type).toBe('header');
    expect(violations(out)).toEqual([]);
    expect(r.response.layout_key).toBe('default-v1+evil');
  });

  it('kill switch (ctx = null) → static default, no rules, no experiment', () => {
    const rules = [rule({ key: 'hide_hydration', actions: [{ op: 'hide', card: 'hydration' }] })];
    const r = composeFeed({ support: SPEC_SUPPORT, ctx: null, rules });
    expect(r.response.layout_key).toBe(DEFAULT_LAYOUT_KEY);
    expect(r.response.experiment).toBeNull();
    expect(types(r.response.cards)).toContain('hydration');
    expect(r.trace).toMatchObject({ ranker: 'default', appliedRules: [] });
  });

  it('rules + experiment: layout_key and experiment reported, guardrails still hold', () => {
    const exp = rule({
      key: 'water_first',
      priority: 100,
      platforms: ['ios', 'android'],
      minAppVersion: '1.0.8',
      experiment: {
        key: 'water_first',
        arms: [
          { name: 'treatment', percent: 50, actions: [{ op: 'move', card: 'hydration', after: 'header' }, { op: 'move', card: 'referral', after: 'hydration' }] },
          { name: 'control', percent: 50, actions: [] },
        ],
      },
    });
    const users = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const treated = users.find((u) => bucketOf(u, 'water_first') < 50)!;
    const control = users.find((u) => bucketOf(u, 'water_first') >= 50)!;

    const t = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx({ userId: treated, ...withCampaign() }), rules: [exp] });
    expect(t.response.experiment).toEqual({ key: 'water_first', arm: 'treatment' });
    expect(t.response.layout_key).toBe('default-v1+water_first.treatment');
    expect(ids(t).slice(0, 4)).toEqual(['offline_banner', 'header', 'hydration', 'referral']);
    expect(violations(t.response.cards.slice(1))).toEqual([]);

    const c = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx({ userId: control, ...withCampaign() }), rules: [exp] });
    expect(c.response.experiment).toEqual({ key: 'water_first', arm: 'control' });
    expect(c.response.layout_key).toBe('default-v1+water_first.control');
    expect(ids(c)).toEqual(ids(composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx({ userId: control, ...withCampaign() }) })));

    // 1.0.7 / unknown version / web: not in the experiment at all.
    for (const ctx of [makeCtx({ userId: treated, appVersion: '1.0.7' }), makeCtx({ userId: treated, appVersion: null }), makeCtx({ userId: treated, platform: 'web' })]) {
      const r = composeFeed({ support: SPEC_SUPPORT, ctx, rules: [exp] });
      expect(r.response.experiment).toBeNull();
      expect(r.response.layout_key).toBe(DEFAULT_LAYOUT_KEY);
    }
  });

  it('a rule that would break a guardrail is corrected (hydration moved alone snaps back to referral)', () => {
    const r = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx(withCampaign()), rules: [rule({ key: 'h', actions: [{ op: 'move', card: 'hydration', toTop: true }] })] });
    const t = types(r.response.cards);
    expect(t[1]).toBe('header');
    expect(t.indexOf('hydration')).toBe(t.indexOf('referral') - 1);
    expect(r.trace.guardrailAdjustments).toContain('header moved first');
  });

  it('is deterministic for the same input', () => {
    const rules = [rule({ key: 'b', actions: [{ op: 'boost', card: 'charts', by: 30 }], audience: { percent: 50 } })];
    const a = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx(), rules, now: NOW, decisionId: 'x' });
    const b = composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx(), rules, now: NOW, decisionId: 'x' });
    expect(a).toEqual(b);
  });

  it('omits empty props and unset variants from cards', () => {
    for (const card of composeFeed({ support: SPEC_SUPPORT, ctx: makeCtx() }).response.cards) {
      expect(Object.keys(card).sort()).toEqual(['id', 'type', 'version']);
    }
  });
});

describe('kill switches', () => {
  it('HOME_FEED_ENABLED defaults on; off values disable', () => {
    expect(isFeedEnabled('ios', {})).toBe(true);
    expect(isFeedEnabled(null, {})).toBe(true);
    for (const v of ['0', 'false', 'OFF', ' no ']) expect(isFeedEnabled('ios', { HOME_FEED_ENABLED: v })).toBe(false);
    expect(isFeedEnabled('ios', { HOME_FEED_ENABLED: 'true' })).toBe(true);
  });

  it('HOME_FEED_PLATFORMS restricts platforms; unknown platform excluded when set', () => {
    const env = { HOME_FEED_PLATFORMS: 'ios, Android' };
    expect(isFeedEnabled('ios', env)).toBe(true);
    expect(isFeedEnabled('android', env)).toBe(true);
    expect(isFeedEnabled('web', env)).toBe(false);
    expect(isFeedEnabled(null, env)).toBe(false);
    expect(isFeedEnabled('web', { HOME_FEED_PLATFORMS: '' })).toBe(true);
  });

  it('HOME_FEED_RULES_ENABLED', () => {
    expect(areRulesEnabled({})).toBe(true);
    expect(areRulesEnabled({ HOME_FEED_RULES_ENABLED: 'false' })).toBe(false);
  });
});
