/**
 * Promo button styles + card surface (docs/PROMO_BUTTON_STYLE_SPEC.md): capability parsing, presets,
 * schema validation, WCAG label contrast on every stop, button-vs-card separation, eyebrow contrast,
 * deterministic A/B variants and the send-time fallback.
 */
import { describe, expect, it } from 'vitest';

import { contrastRatio, deltaE } from '../color';
import { promoPropsSchema } from '../creative';
import {
  BRAND_EYEBROW,
  DARK_SURFACE,
  DEFAULT_APPEARANCE,
  LOOK_PRESETS,
  PRESETS,
  appearanceSchema,
  applyAppearance,
  autoLabel,
  buttonStyleInputSchema,
  checkAppearance,
  checkStyleSetting,
  parseFeatureTokens,
  pickStyleVariant,
  resolveButtonStyle,
  styleSettingSchema,
  styledProps,
  supportsPromoStyle,
  type PromoAppearance,
  type StyleSetting,
} from '../style';
import type { PromoProps, PromoTheme } from '../types';

const PRO_EXPIRING: PromoTheme = { background: { kind: 'gradient', colors: ['#1E1B4B', '#4338CA', '#7C3AED'] }, foreground: 'light' };
const PRO_EXPIRED: PromoTheme = { background: { kind: 'gradient', colors: ['#3B0764', '#7E22CE', '#BE185D'] }, foreground: 'light' };
const LOG_MEAL: PromoTheme = { background: { kind: 'gradient', colors: ['#064E3B', '#047857', '#0E7490'] }, foreground: 'light' };
const hero = (theme: PromoTheme = PRO_EXPIRING) => ({ theme, layout: 'hero' as const });
const errors = (a: PromoAppearance, card = hero()) => checkAppearance(a, card).filter((i) => i.level === 'error');
const warnings = (a: PromoAppearance, card = hero()) => checkAppearance(a, card).filter((i) => i.level === 'warning');
const look = (raw: unknown) => appearanceSchema.parse(raw);

const props = (over: Partial<PromoProps> = {}): PromoProps => ({
  promoId: 'pro_expiring',
  creativeId: 'pro_expiring_hero_trial_usage',
  layout: 'hero',
  theme: PRO_EXPIRING,
  icon: 'hourglass',
  eyebrow: 'FitCircle Pro',
  title: 'Your free Pro week ends tomorrow',
  body: 'Keep it going.',
  primary: { label: 'Start 7-day free trial', action: { type: 'paywall', params: { placement: 'pro_expiring_card' } } },
  dismissible: true,
  ...over,
});

describe('capability', () => {
  it('parses versioned tokens from the query and X-Client-Features, ignoring junk', () => {
    const f = parseFeatureTokens('promo_style@1', 'icon_keys, reactions_v2 ,BAD TOKEN,x@0,y@abc');
    expect(f.get('promo_style')).toBe(1);
    expect(f.get('icon_keys')).toBe(1);
    expect(f.has('x')).toBe(false);
    expect(f.has('y')).toBe(false);
    expect(supportsPromoStyle(f)).toBe(true);
    expect(supportsPromoStyle(parseFeatureTokens('PROMO_STYLE'))).toBe(true); // bare = v1, case-insensitive
    expect(supportsPromoStyle(parseFeatureTokens(null, undefined, ''))).toBe(false);
    expect(supportsPromoStyle(undefined)).toBe(false);
    expect(parseFeatureTokens('promo_style@1,promo_style@3').get('promo_style')).toBe(3);
  });
});

describe('presets', () => {
  it('paywall = the exact paywall CTA gradient (#7C3AED → #DB2777, leading → trailing), white label at AA on both stops', () => {
    expect(PRESETS.paywall.style).toEqual({ kind: 'gradient', preset: 'paywall', gradient: { colors: ['#7C3AED', '#DB2777'], angle: 90 }, text: '#FFFFFF' });
    for (const c of PRESETS.paywall.style.gradient!.colors) expect(contrastRatio('#FFFFFF', c)).toBeGreaterThanOrEqual(4.5);
    expect(PRESETS.brand_purple.style).toEqual({ kind: 'solid', preset: 'brand_purple', fill: '#7C3AED', text: '#FFFFFF' });
    expect(PRESETS.white.style).toEqual({ kind: 'white', preset: 'white', fill: '#FFFFFF', text: '#111111' });
  });

  it('resolve: presets expand, custom gets the auto label + default angle, uppercase hex, icon kept', () => {
    expect(resolveButtonStyle({ preset: 'paywall' })).toEqual(PRESETS.paywall.style);
    expect(resolveButtonStyle({ kind: 'solid', fill: '#fde68a' })).toEqual({ kind: 'solid', fill: '#FDE68A', text: '#111111' });
    expect(resolveButtonStyle({ kind: 'gradient', gradient: { colors: ['#0f766e', '#1d4ed8'] }, icon: 'crown' })).toEqual({ kind: 'gradient', gradient: { colors: ['#0F766E', '#1D4ED8'], angle: 90 }, text: '#FFFFFF', icon: 'crown' });
    expect(resolveButtonStyle({ kind: 'white' })).toEqual({ kind: 'white', fill: '#FFFFFF', text: '#111111' });
    expect(resolveButtonStyle({ kind: 'solid', fill: '#7C3AED', text: '#fafafa' }).text).toBe('#FAFAFA');
    expect(autoLabel(['#FFFFFF'])).toBe('#111111');
    expect(autoLabel(['#111111', '#7C3AED'])).toBe('#FFFFFF');
  });
});

describe('schema', () => {
  it('rejects bad hex, preset + kind, missing fills, stray fields, 1 or 4 stops, bad angle', () => {
    const bad = [
      { kind: 'solid', fill: '7C3AED' },
      { kind: 'solid', fill: '#7C3AE' },
      { preset: 'paywall', kind: 'solid', fill: '#7C3AED' },
      { preset: 'paywall', fill: '#7C3AED' },
      { kind: 'solid' },
      { kind: 'gradient', gradient: { colors: ['#7C3AED'] } },
      { kind: 'gradient', gradient: { colors: ['#7C3AED', '#DB2777', '#000000', '#FFFFFF'] } },
      { kind: 'gradient', gradient: { colors: ['#7C3AED', '#DB2777'], angle: 360 } },
      { kind: 'white', fill: '#FFFFFF' },
      { kind: 'solid', fill: '#7C3AED', text: 'white' },
      { preset: 'neon' },
      {},
      { kind: 'solid', fill: '#7C3AED', shadow: true },
    ];
    for (const b of bad) expect(buttonStyleInputSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
    expect(appearanceSchema.safeParse({ surface: 'glass', button: { preset: 'white' } }).success).toBe(false);
    expect(appearanceSchema.safeParse({ button: { preset: 'white' }, eyebrowColor: 'purple' }).success).toBe(false);
    expect(appearanceSchema.parse({ button: { preset: 'white' } }).surface).toBe('gradient');
  });

  it('settings: 1–3 variants, unique ids, some weight', () => {
    const v = (id: string, weight = 50) => ({ id, weight, button: { preset: 'white' } });
    expect(styleSettingSchema.safeParse({ variants: [v('a'), v('b')] }).success).toBe(true);
    expect(styleSettingSchema.safeParse({ variants: [] }).success).toBe(false);
    expect(styleSettingSchema.safeParse({ variants: [v('a'), v('b'), v('c'), v('d')] }).success).toBe(false);
    expect(styleSettingSchema.safeParse({ variants: [v('a'), v('a')] }).success).toBe(false);
    expect(styleSettingSchema.safeParse({ variants: [v('a', 0)] }).success).toBe(false);
    expect(styleSettingSchema.safeParse({ variants: [v('A')] }).success).toBe(false);
  });
});

describe('contrast + separation checks', () => {
  it("today's look and the three shipped looks pass on their intended surfaces", () => {
    expect(checkAppearance(DEFAULT_APPEARANCE, hero())).toEqual([]);
    expect(checkAppearance(LOOK_PRESETS.paywall_style.appearance, hero())).toEqual([]);
    expect(checkAppearance(LOOK_PRESETS.brand_purple.appearance, hero(PRO_EXPIRED))).toEqual([]);
    expect(contrastRatio(BRAND_EYEBROW, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5);
  });

  it('blocks a purple button on a purple card (paywall gradient / brand purple on the gradient surface)', () => {
    for (const button of [{ preset: 'paywall' }, { preset: 'brand_purple' }]) {
      const e = errors(look({ surface: 'gradient', button }));
      expect(e).toHaveLength(1);
      expect(e[0]).toMatchObject({ path: 'button' });
      expect(e[0].message).toMatch(/blends into the card/);
    }
    // ΔE confirms these really are the same colour, not just the same lightness.
    expect(deltaE('#7C3AED', '#7C3AED')).toBe(0);
  });

  it('hue-only separation (purple on a teal/green card) warns instead of blocking', () => {
    const a = look({ surface: 'gradient', button: { preset: 'brand_purple' } });
    expect(errors(a, hero(LOG_MEAL))).toEqual([]);
    expect(warnings(a, hero(LOG_MEAL))[0].message).toMatch(/hue only/);
  });

  it('checks the label against EVERY gradient stop (the old #8B5CF6 → #EC4899 fails on pink)', () => {
    const a = look({ surface: 'dark', button: { kind: 'gradient', gradient: { colors: ['#8B5CF6', '#EC4899'] }, text: '#FFFFFF' } });
    const e = errors(a);
    expect(e.map((i) => i.path)).toEqual(['button.text', 'button.text']);
    expect(e[0].message).toMatch(/#8B5CF6.*4\.2:1/);
    expect(e[1].message).toMatch(/#EC4899.*3\.5:1/);
    // A custom dark label on a mid-tone solid also fails; "auto" picks the better of white / #111111.
    expect(errors(look({ surface: 'dark', button: { kind: 'solid', fill: '#7C3AED', text: '#111111' } }))[0].path).toBe('button.text');
    expect(errors(look({ surface: 'dark', button: { kind: 'solid', fill: '#7C3AED', text: 'auto' } }))).toEqual([]);
  });

  it('a white button on the dark surface is fine; a near-black button on the dark surface is blocked', () => {
    expect(errors(look({ surface: 'dark', button: { preset: 'white' } }))).toEqual([]);
    expect(errors(look({ surface: 'dark', button: { kind: 'solid', fill: '#151B33' } })).some((i) => i.path === 'button')).toBe(true);
  });

  it('eyebrow colour must reach 4.5:1 on the surface', () => {
    expect(errors(look({ surface: 'dark', button: { preset: 'paywall' }, eyebrowColor: '#4338CA' }))[0]).toMatchObject({ path: 'eyebrowColor' });
    expect(errors(look({ surface: 'gradient', button: { preset: 'white' }, eyebrowColor: '#FDE68A' }))).toEqual([]);
    expect(errors(look({ surface: 'dark', button: { preset: 'paywall' }, eyebrowColor: 'auto' }))).toEqual([]);
  });

  it('banner / compact: a custom button style warns (not drawn), no label checks', () => {
    const a = look({ surface: 'dark', button: { preset: 'paywall' } });
    expect(checkAppearance(a, { theme: PRO_EXPIRING, layout: 'banner' })).toEqual([expect.objectContaining({ level: 'warning', path: 'button' })]);
    expect(checkAppearance(DEFAULT_APPEARANCE, { theme: PRO_EXPIRING, layout: 'compact' })).toEqual([]);
  });

  it('checkStyleSetting prefixes variant paths and names the variant', () => {
    const s: StyleSetting = styleSettingSchema.parse({ variants: [{ id: 'a', weight: 50, button: { preset: 'white' } }, { id: 'b', weight: 50, surface: 'gradient', button: { preset: 'paywall' } }] });
    const issues = checkStyleSetting(s, [hero()]);
    expect(issues).toEqual([expect.objectContaining({ level: 'error', path: 'variants.1.button' })]);
    expect(issues[0].message).toMatch(/^Variant B:/);
  });
});

describe('variants + apply', () => {
  const AB: StyleSetting = styleSettingSchema.parse({
    variants: [
      { id: 'a', weight: 50, ...DEFAULT_APPEARANCE },
      { id: 'b', weight: 50, ...LOOK_PRESETS.paywall_style.appearance },
    ],
  });

  it('variant choice is deterministic per user and roughly follows the weights', () => {
    const users = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const picks = users.map((u) => pickStyleVariant(AB, 'pro_expiring', u).id);
    expect(users.map((u) => pickStyleVariant(AB, 'pro_expiring', u).id)).toEqual(picks);
    const b = picks.filter((p) => p === 'b').length / picks.length;
    expect(b).toBeGreaterThan(0.45);
    expect(b).toBeLessThan(0.55);
    const skew = styleSettingSchema.parse({ variants: [AB.variants[0], { ...AB.variants[1], weight: 0 }] });
    expect(users.every((u) => pickStyleVariant(skew, 'k', u).id === 'a')).toBe(true);
  });

  it('applyAppearance: style on the hero primary only, surface always, eyebrow when custom; props stay schema-valid', () => {
    const out = applyAppearance(props(), LOOK_PRESETS.paywall_style.appearance);
    expect(out.primary.style).toEqual(PRESETS.paywall.style);
    expect(out).toMatchObject({ surface: 'dark', eyebrowColor: '#A78BFA' });
    expect(out.theme).toEqual(PRO_EXPIRING); // theme untouched (and never gains an accent)
    expect(out.theme.accent).toBeUndefined();
    expect(promoPropsSchema.safeParse(out).success).toBe(true);
    const banner = applyAppearance(props({ layout: 'banner' }), LOOK_PRESETS.paywall_style.appearance);
    expect(banner.primary.style).toBeUndefined();
    expect(banner.surface).toBe('dark');
    expect(applyAppearance(props({ layout: 'compact' }), LOOK_PRESETS.paywall_style.appearance).eyebrowColor).toBeUndefined();
  });

  it('styledProps: no setting → default look, creative id unchanged', () => {
    const r = styledProps('pro_expiring', props(), undefined, 'u1');
    expect(r.variantId).toBeNull();
    expect(r.props.creativeId).toBe('pro_expiring_hero_trial_usage');
    expect(r.props.primary.style).toEqual(PRESETS.white.style);
    expect(r.props.surface).toBe('gradient');
  });

  it('styledProps: an A/B test suffixes the creative id with the variant (events split by look)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = styledProps('pro_expiring', props(), AB, `user-${i}`);
      expect(r.props.creativeId).toBe(`pro_expiring_hero_trial_usage_s${r.variantId}`);
      expect(promoPropsSchema.safeParse(r.props).success).toBe(true);
      seen.add(r.variantId!);
    }
    expect([...seen].sort()).toEqual(['a', 'b']);
    // A single variant is not a test: no suffix.
    const one = styleSettingSchema.parse({ variants: [AB.variants[1]] });
    expect(styledProps('pro_expiring', props(), one, 'u').props.creativeId).toBe('pro_expiring_hero_trial_usage');
  });

  it('styledProps: a variant failing its checks on this creative falls back to the default look (never drops the promo)', () => {
    const purpleOnPurple = styleSettingSchema.parse({ variants: [{ id: 'b', weight: 100, surface: 'gradient', button: { preset: 'paywall' } }] });
    const r = styledProps('pro_expiring', props(), purpleOnPurple, 'u');
    expect(r).toMatchObject({ variantId: null, rejected: 'contrast' });
    expect(r.props.primary.style).toEqual(PRESETS.white.style);
    expect(styledProps('pro_expiring', props(), { variants: [] } as unknown as StyleSetting, 'u')).toMatchObject({ variantId: null, rejected: 'invalid_setting' });
  });
});
