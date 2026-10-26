/**
 * promo@1 in the feed pipeline: guardrails G7–G9 (PROMO_CARD_SPEC §6.2,
 * ACTIVATION_JOURNEY_SPEC §3), first_meal position, legacy pro_upsell
 * replacement, rules addressing `promo:<key>`, and unchanged legacy feeds.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_MEAL_REMINDER_PREFS } from '../../journey/meal-slots';
import { ACTION_TYPES, SYSTEM_PROMOS, parsePromoClient, promosConfig, selectPromos, type JourneyContext } from '../../promos';
import { parseClientCards } from '../candidates';
import { composeFeed } from '../compose';
import { applyGuardrails, violations } from '../guardrails';

import { IOS_CARDS, makeCtx, rule, withCampaign } from './helpers';

const PROMO_CARDS = parseClientCards(`${IOS_CARDS},promo@1`);
const LEGACY_CARDS = parseClientCards(IOS_CARDS);
const CLIENT = parsePromoClient({ cardsSupportPromo: true, actions: ACTION_TYPES.map((t) => `${t}@1`).join(','), promoLayouts: 'hero,banner,compact' });
const CFG = promosConfig({ PROMOS_ENABLED: 'true' });

const journey = (over: Partial<JourneyContext> = {}): JourneyContext => ({
  hasLoggedMeal: true,
  loggedSlotsToday: [],
  lastMeal: { title: 'Oats', mealType: 'breakfast' },
  signupAt: '2026-10-01T00:00:00Z',
  fitzyOpenedAt: null,
  mealReminderPrefs: { ...DEFAULT_MEAL_REMINDER_PREFS },
  localMinutes: 9 * 60,
  ...over,
});

function feed(opts: { j?: Partial<JourneyContext>; ctx?: Parameters<typeof makeCtx>[0]; rules?: ReturnType<typeof rule>[]; support?: ReturnType<typeof parseClientCards> } = {}) {
  const ctx = makeCtx(opts.ctx);
  const promos = selectPromos({ definitions: SYSTEM_PROMOS, ctx, journey: journey(opts.j), state: new Map(), liveProFeatures: new Set(['food_ai_unlimited']), client: CLIENT, config: CFG });
  const support = opts.support ?? PROMO_CARDS;
  return composeFeed({ support, ctx, rules: opts.rules ?? [], promos: promos.candidates, replacedTypes: new Set(['pro_upsell']), promoV1: (support.get('promo') ?? 0) >= 1 });
}
const ids = (r: ReturnType<typeof feed>) => r.response.cards.map((c) => c.id);

describe('guardrails G7–G9 (promo@1 clients)', () => {
  const g = (list: string[]) => list.map((id) => ({ id, type: id.startsWith('promo:') ? 'promo' : id.split(':')[0] }));

  it('G7: at most 2 promo-category cards; lower-ranked extras dropped', () => {
    const r = applyGuardrails(g(['header', 'campaign:htl', 'daily_goals', 'promo:pro_value', 'progress', 'promo:meet_fitzy', 'vitals', 'referral', 'charts']), { promoV1: true });
    const promoIds = r.cards.map((c) => c.id).filter((id) => id === 'campaign:htl' || id === 'referral' || id.startsWith('promo:'));
    expect(promoIds).toEqual(['campaign:htl', 'promo:pro_value']);
    expect(violations(r.cards, { promoV1: true })).toEqual([]);
  });

  it('G8: at most 1 promo in the first 4', () => {
    const r = applyGuardrails(g(['header', 'promo:log_meal_now', 'hydration', 'promo:pro_value', 'daily_goals', 'progress', 'vitals']), { promoV1: true });
    const top4 = r.cards.slice(0, 4).filter((c) => c.type === 'promo');
    expect(top4).toHaveLength(1);
    expect(r.cards.map((c) => c.id)).toContain('promo:pro_value');
    expect(violations(r.cards, { promoV1: true })).toEqual([]);
  });

  it('G9: first_meal is utility — position ≤ 2, exempt from density, may sit next to a promo', () => {
    const r = applyGuardrails(g(['header', 'campaign:htl', 'daily_goals', 'progress', 'promo:first_meal', 'vitals', 'charts']), { promoV1: true });
    expect(r.cards.map((c) => c.id).slice(0, 3)).toEqual(['header', 'promo:first_meal', 'campaign:htl']);
    expect(violations(r.cards, { promoV1: true })).toEqual([]);
  });

  it('legacy clients: G7–G9 do not apply (3 legacy promo cards, 2 in the first 4 still allowed)', () => {
    const legacy = g(['header', 'campaign:htl', 'hydration', 'referral', 'streak_warning', 'daily_goals', 'pro_upsell']);
    const r = applyGuardrails(legacy);
    expect(r.cards.map((c) => c.id)).toEqual(legacy.map((c) => c.id));
    expect(violations(r.cards)).toEqual([]);
    expect(violations(r.cards, { promoV1: true })).toEqual(['G8 >1 promo in first 4', 'G7 >2 promos in feed']);
  });
});

describe('compose with promos', () => {
  it('a brand-new user: first_meal right under the header, even with a live campaign', () => {
    for (const ctx of [{}, withCampaign()]) {
      const r = feed({ j: { hasLoggedMeal: false, lastMeal: null }, ctx });
      expect(ids(r).slice(0, 3)).toEqual(['offline_banner', 'header', 'promo:first_meal']);
      expect(violations(r.response.cards.slice(1), { promoV1: true })).toEqual([]);
    }
  });

  it('pro_value replaces pro_upsell for promo@1 clients; props carry the resolved creative', () => {
    const r = feed({ j: { loggedSlotsToday: ['breakfast'] } });
    expect(ids(r)).not.toContain('pro_upsell');
    const pv = r.response.cards.find((c) => c.id === 'promo:pro_value');
    expect(pv).toMatchObject({ type: 'promo', version: 1 });
    expect(pv!.props).toMatchObject({ promoId: 'pro_value', layout: 'banner', primary: { action: { type: 'paywall', params: { placement: 'feed_pro_value' } } } });
    expect(r.trace.suppressed).toContain('pro_upsell');
  });

  it('activation promos outrank the evergreen referral card under the 2-promo cap', () => {
    const r = feed();
    const promoIds = ids(r).filter((id) => id.startsWith('promo:') || id === 'referral' || id.startsWith('campaign'));
    expect(promoIds).toEqual(['promo:log_meal_now', 'promo:pro_value']);
    expect(ids(feed({ j: { loggedSlotsToday: ['breakfast'] } })).filter((id) => id.startsWith('promo:') || id === 'referral')).toEqual(['promo:pro_value', 'referral']);
  });

  it('activated free user: ≤ 2 promo-category cards, ≤ 1 in the first 4, never two adjacent, pro_value never next to the campaign', () => {
    for (const ctx of [{}, withCampaign(), { localHour: 12 }]) {
      const r = feed({ ctx });
      const cards = r.response.cards.slice(1);
      expect(violations(cards, { promoV1: true })).toEqual([]);
      const i = cards.findIndex((c) => c.id === 'promo:pro_value');
      const k = cards.findIndex((c) => c.type === 'campaign');
      if (i !== -1 && k !== -1) expect(Math.abs(i - k)).toBeGreaterThan(1);
    }
  });

  it('a legacy client (no promo@1) gets exactly the old feed even when promos are passed', () => {
    const ctx = makeCtx();
    const before = composeFeed({ support: LEGACY_CARDS, ctx, rules: [] }).response.cards.map((c) => c.id);
    const r = feed({ support: LEGACY_CARDS });
    expect(ids(r).filter((id) => id !== 'pro_upsell')).toEqual(before.filter((id) => id !== 'pro_upsell'));
    expect(ids(r).some((id) => id.startsWith('promo:'))).toBe(false);
  });

  it('rules address one promo by id (hide / move) or all promos by type', () => {
    const hideFitzy = rule({ key: 'no_fitzy_promo', actions: [{ op: 'hide', card: 'promo:meet_fitzy' }] });
    expect(ids(feed({ rules: [hideFitzy] }))).not.toContain('promo:meet_fitzy');
    const hideAll = rule({ key: 'no_promos', actions: [{ op: 'hide', card: 'promo' }] });
    expect(ids(feed({ rules: [hideAll] })).some((id) => id.startsWith('promo:'))).toBe(false);
    const sink = rule({ key: 'sink_pv', actions: [{ op: 'move', card: 'promo:pro_value', toBottom: true }] });
    const r = feed({ rules: [sink], j: { loggedSlotsToday: ['breakfast'] }, ctx: { referralProgramEnabled: false } });
    expect(ids(r).indexOf('promo:pro_value')).toBeGreaterThan(ids(r).indexOf('progress'));
  });
});
