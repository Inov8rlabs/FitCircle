/**
 * promo@1 engine (PROMO_CARD_SPEC §4, §6.1, §7): action registry + fallback
 * resolution, creative validation, caps, deterministic bucketing, selection.
 */
import { describe, expect, it } from 'vitest';

import {
  ACTION_TYPES,
  OPEN_SCREENS_V1,
  buildPromoProps,
  capReason,
  contrastOk,
  fillPlaceholders,
  midColor,
  parseClientActions,
  parsePromoClient,
  parsePromoLayouts,
  pickCreative,
  promoPropsSchema,
  promosConfig,
  resolveAction,
  selectPromos,
  type CreativeOption,
  type JourneyContext,
  type PromoClientSupport,
  type PromoDefinition,
  type PromoUserState,
} from '..';
import { makeCtx, USER } from '../../home-feed/__tests__/helpers';
import { bucketOf } from '../../home-feed/rules';
import { DEFAULT_MEAL_REMINDER_PREFS } from '../../journey/meal-slots';

const ALL_ACTIONS = ACTION_TYPES.map((t) => `${t}@1`).join(',');
const FULL: PromoClientSupport = parsePromoClient({ cardsSupportPromo: true, actions: ALL_ACTIONS, promoLayouts: 'hero,banner,compact' });
const ON = promosConfig({ PROMOS_ENABLED: 'true' });

const state = (over: Partial<PromoUserState> = {}): PromoUserState => ({
  promoKey: 'x',
  creativeId: null,
  impressionsTotal: 0,
  impressionsDay: 0,
  day: null,
  seenDays: [],
  dismissedAt: null,
  tappedAt: null,
  convertedAt: null,
  ...over,
});

const journey = (over: Partial<JourneyContext> = {}): JourneyContext => ({
  hasLoggedMeal: true,
  loggedSlotsToday: [],
  lastMeal: null,
  signupAt: '2026-10-01T00:00:00Z',
  fitzyOpenedAt: null,
  mealReminderPrefs: { ...DEFAULT_MEAL_REMINDER_PREFS },
  localMinutes: 9 * 60,
  ...over,
});

const creative = (over: Partial<CreativeOption> = {}): CreativeOption => ({
  id: 'c_a',
  weight: 50,
  layout: 'banner',
  theme: { background: { kind: 'gradient', colors: ['#1E1B4B', '#4338CA', '#7C3AED'] }, foreground: 'light' },
  emoji: '✨',
  title: 'Hello',
  body: 'World',
  primary: { label: 'Go', action: { type: 'open_screen', params: { screen: 'food_log' } } },
  dismissible: true,
  ...over,
});

describe('client declaration parsing (§6.1)', () => {
  it('parses actions like cards= and defaults to dismiss only', () => {
    expect([...parseClientActions('open_screen@1, paywall@2,bad token,x@y,invite')]).toEqual([
      ['open_screen', 1],
      ['paywall', 2],
      ['invite', 1],
    ]);
    expect([...parseClientActions(null)]).toEqual([['dismiss', 1]]);
    expect([...parseClientActions('')]).toEqual([['dismiss', 1]]);
  });
  it('parses layouts (unknown ignored, missing = none)', () => {
    expect([...parsePromoLayouts('hero, BANNER,carousel')]).toEqual(['hero', 'banner']);
    expect(parsePromoLayouts(undefined).size).toBe(0);
  });
});

describe('action registry + fallback resolution (§4)', () => {
  const actions = parseClientActions('open_screen@1,paywall@1');
  it('resolves a supported, valid action as-is (no fallback on the wire)', () => {
    expect(resolveAction({ type: 'paywall', params: { placement: 'feed_pro_value' } }, actions)).toEqual({ type: 'paywall', params: { placement: 'feed_pro_value' } });
  });
  it('walks the fallback chain to the first supported action', () => {
    const a = { type: 'log_water', params: { ml: 250 }, fallback: [{ type: 'join_campaign', params: { campaign: 'x' } }, { type: 'open_screen', params: { screen: 'hydration' } }] };
    expect(resolveAction(a, actions)).toEqual({ type: 'open_screen', params: { screen: 'hydration' } });
    expect(resolveAction({ type: 'log_water', params: { ml: 250 } }, actions)).toBeNull();
  });
  it('treats invalid params as unsupported (→ fallback)', () => {
    const bad = { type: 'open_screen', params: { screen: 'admin_panel' }, fallback: [{ type: 'open_screen', params: { screen: 'food_log' } }] };
    expect(resolveAction(bad, actions)).toEqual({ type: 'open_screen', params: { screen: 'food_log' } });
    expect(resolveAction({ type: 'open_screen', params: { screen: 'log_meal', meal: 'brunch' } }, actions)).toBeNull();
    expect(resolveAction({ type: 'open_screen', params: { screen: 'fitzy', prompt: 'x'.repeat(201) } }, actions)).toBeNull();
  });
  it('requires the declared version', () => {
    expect(resolveAction({ type: 'open_screen', version: 2, params: { screen: 'food_log' } }, actions)).toBeNull();
  });
  it('open_url: https + allowlisted host only', () => {
    const all = parseClientActions(ALL_ACTIONS);
    expect(resolveAction({ type: 'open_url', params: { url: 'https://fitcircle.ai/pro', mode: 'in_app' } }, all)).not.toBeNull();
    expect(resolveAction({ type: 'open_url', params: { url: 'http://fitcircle.ai/pro', mode: 'in_app' } }, all)).toBeNull();
    expect(resolveAction({ type: 'open_url', params: { url: 'https://evil.example/pro', mode: 'external' } }, all)).toBeNull();
    expect(resolveAction({ type: 'open_url', params: { url: 'https://user:pw@fitcircle.ai/', mode: 'external' } }, all)).toBeNull();
  });
  it('the v1 screen list includes the journey screens', () => {
    for (const s of ['log_meal', 'fitzy', 'food_log', 'campaign', 'circles', 'settings_notifications']) expect(OPEN_SCREENS_V1).toContain(s);
  });
});

describe('creative validation + props', () => {
  it('builds props with resolved actions and drops an unresolvable secondary', () => {
    const hero = creative({
      layout: 'hero',
      secondary: { label: 'Later', action: { type: 'log_water', params: { ml: 250 } } },
    });
    const props = buildPromoProps('demo_promo', hero, parseClientActions('open_screen@1'))!;
    expect(props.primary).toEqual({ label: 'Go', action: { type: 'open_screen', params: { screen: 'food_log' } } });
    expect(props.secondary).toBeUndefined();
    expect((props.primary.action as any).fallback).toBeUndefined();
  });
  it('drops the creative when the primary cannot resolve', () => {
    expect(buildPromoProps('demo_promo', creative({ primary: { label: 'Pay', action: { type: 'paywall', params: { placement: 'x' } } } }), parseClientActions(null))).toBeNull();
  });
  it('rejects over-long / markup text, a secondary on a banner, and low contrast', () => {
    const actions = parseClientActions(ALL_ACTIONS);
    expect(buildPromoProps('demo_promo', creative({ title: 'x'.repeat(45) }), actions)).toBeNull();
    expect(buildPromoProps('demo_promo', creative({ body: 'see [this](https://x)' }), actions)).toBeNull();
    const base = buildPromoProps('demo_promo', creative(), actions)!;
    expect(promoPropsSchema.safeParse({ ...base, secondary: base.primary }).success).toBe(false);
    expect(buildPromoProps('demo_promo', creative({ theme: { background: { kind: 'solid', color: '#FDE68A' }, foreground: 'light' } }), actions)).toBeNull();
  });
  it('mid colour + contrast', () => {
    expect(midColor({ background: { kind: 'gradient', colors: ['#000000', '#FFFFFF'] }, foreground: 'dark' })).toBe('#808080');
    expect(contrastOk({ background: { kind: 'solid', color: '#4338CA' }, foreground: 'light' })).toBe(true);
    expect(contrastOk({ background: { kind: 'solid', color: '#4338CA' }, foreground: 'dark' })).toBe(false);
  });
  it('placeholders resolve or fail', () => {
    expect(fillPlaceholders('Hi {{first_name}}, {{streak}} days', { first_name: 'Sam', streak: 3 })).toBe('Hi Sam, 3 days');
    expect(fillPlaceholders('Hi {{first_name}}', { first_name: '' })).toBeNull();
    expect(fillPlaceholders('Hi {{nickname}}', {})).toBeNull();
  });
});

describe('caps (§7.2)', () => {
  const now = new Date('2026-10-26T15:00:00Z');
  it('dismiss cooldown', () => {
    const s = state({ dismissedAt: '2026-10-26T14:00:00Z' });
    expect(capReason({ cooldownHoursAfterDismiss: 2 }, s, now, '2026-10-26')).toBe('dismiss_cooldown');
    expect(capReason({ cooldownHoursAfterDismiss: 1 }, s, now, '2026-10-26')).toBeNull();
  });
  it('hide after conversion', () => {
    expect(capReason({ hideAfterConversion: true }, state({ convertedAt: '2026-10-20T00:00:00Z' }), now, '2026-10-26')).toBe('converted');
    expect(capReason({}, state({ convertedAt: '2026-10-20T00:00:00Z' }), now, '2026-10-26')).toBeNull();
  });
  it('perDay counts only today’s impressions', () => {
    expect(capReason({ perDay: 2 }, state({ day: '2026-10-26', impressionsDay: 2 }), now, '2026-10-26')).toBe('day_cap');
    expect(capReason({ perDay: 2 }, state({ day: '2026-10-25', impressionsDay: 9 }), now, '2026-10-26')).toBeNull();
  });
  it('perWeek = distinct local days in the last 7; today already counted stays visible', () => {
    const three = state({ seenDays: ['2026-10-25', '2026-10-23', '2026-10-21'] });
    expect(capReason({ perWeek: 3 }, three, now, '2026-10-26')).toBe('week_cap');
    expect(capReason({ perWeek: 3 }, state({ seenDays: ['2026-10-26', '2026-10-25', '2026-10-23'] }), now, '2026-10-26')).toBeNull();
    expect(capReason({ perWeek: 3 }, state({ seenDays: ['2026-10-25', '2026-10-23', '2026-10-19'] }), now, '2026-10-26')).toBeNull();
  });
  it('total', () => {
    expect(capReason({ total: 5 }, state({ impressionsTotal: 5 }), now, '2026-10-26')).toBe('total_cap');
  });
});

describe('deterministic creative bucketing (§7.3)', () => {
  const opts = [creative({ id: 'a', weight: 34 }), creative({ id: 'b', weight: 33 }), creative({ id: 'c', weight: 33 })];
  const users = Array.from({ length: 3000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  it('is stable per user and follows the weights', () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (const u of users) {
      const first = pickCreative(opts, () => true, 'pro_value', u)!.id;
      expect(pickCreative(opts, () => true, 'pro_value', u)!.id).toBe(first);
      counts[first]++;
    }
    for (const k of ['a', 'b', 'c']) expect(counts[k] / users.length).toBeGreaterThan(0.28);
    expect(counts.a / users.length).toBeLessThan(0.4);
  });
  it('maps the same bucket the rules engine uses (sha256(salt:user) % 100)', () => {
    const u = users.find((x) => bucketOf(x, 'pro_value') < 34)!;
    expect(pickCreative(opts, () => true, 'pro_value', u)!.id).toBe('a');
  });
  it('moves to the next usable creative when the bucketed one is unavailable', () => {
    const u = users.find((x) => bucketOf(x, 'pro_value') < 34)!;
    expect(pickCreative(opts, (c) => c.id !== 'a', 'pro_value', u)!.id).toBe('b');
    expect(pickCreative(opts, () => false, 'pro_value', u)).toBeNull();
  });
});

describe('selectPromos', () => {
  const def = (over: Partial<PromoDefinition> = {}): PromoDefinition => ({
    key: 'demo_promo',
    kind: 'promo',
    score: 900,
    caps: { cooldownHoursAfterDismiss: 24 },
    requiresState: true,
    audience: () => null,
    creatives: () => [creative()],
    ...over,
  });
  const base = { ctx: makeCtx(), journey: journey(), state: new Map<string, PromoUserState>(), liveProFeatures: new Set<string>(), client: FULL, config: ON };

  it('selects an eligible promo as a promo@1 candidate with props', () => {
    const { candidates } = selectPromos({ ...base, definitions: [def()] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ id: 'promo:demo_promo', type: 'promo', version: 1, baseScore: 900, creativeId: 'c_a' });
    expect(candidates[0].props.promoId).toBe('demo_promo');
  });
  it('kill switch, paused keys, client without promo@1, unknown journey', () => {
    expect(selectPromos({ ...base, definitions: [def()], config: promosConfig({}) }).trace[0].outcome).toBe('promos_disabled');
    expect(selectPromos({ ...base, definitions: [def()], config: promosConfig({ PROMOS_ENABLED: '1', PROMOS_DISABLED_KEYS: 'x, demo_promo' }) }).trace[0].outcome).toBe('paused');
    expect(selectPromos({ ...base, definitions: [def()], client: { ...FULL, promoCard: false } }).trace[0].outcome).toBe('client_no_promo');
    expect(selectPromos({ ...base, definitions: [def()], journey: null }).trace[0].outcome).toBe('no_context');
  });
  it('audience, unknown state, caps', () => {
    expect(selectPromos({ ...base, definitions: [def({ audience: () => 'nope' })] }).trace[0].outcome).toBe('audience:nope');
    expect(selectPromos({ ...base, definitions: [def()], state: null }).trace[0].outcome).toBe('state_unknown');
    expect(selectPromos({ ...base, definitions: [def({ requiresState: false })], state: null }).candidates).toHaveLength(1);
    const dismissed = new Map([['demo_promo', state({ dismissedAt: new Date(base.ctx.now.getTime() - 3_600_000).toISOString() })]]);
    expect(selectPromos({ ...base, definitions: [def()], state: dismissed }).trace[0].outcome).toBe('dismiss_cooldown');
  });
  it('a client without the layout or the primary action gets nothing', () => {
    expect(selectPromos({ ...base, definitions: [def()], client: { ...FULL, layouts: new Set(['hero']) } }).trace[0].outcome).toBe('unrenderable');
    expect(selectPromos({ ...base, definitions: [def()], client: parsePromoClient({ cardsSupportPromo: true, actions: null, promoLayouts: 'banner' }) }).trace[0].outcome).toBe('unrenderable');
  });
  it('user id drives bucketing', () => {
    const two = def({ creatives: () => [creative({ id: 'x1' }), creative({ id: 'x2' })] });
    const a = selectPromos({ ...base, definitions: [two] }).candidates[0].creativeId;
    const b = selectPromos({ ...base, definitions: [two], ctx: makeCtx({ userId: USER }) }).candidates[0].creativeId;
    expect(a).toBe(b);
  });
});
