/**
 * Server-controlled promo button styles + card surface (docs/PROMO_BUTTON_STYLE_SPEC.md). Pure.
 *
 * Admins pick, per promo (system promos: the `promo_styles` config) or per Pro lifecycle state, a
 * StyleSetting: 1–3 look variants (A/B by deterministic bucket), each with
 *   surface      'gradient' (today: theme.background) | 'dark' (the Home card surface)
 *   button       a preset ('white' | 'paywall' | 'brand_purple') or a custom white / solid / gradient
 *                fill with an auto or custom label colour and an optional icon
 *   eyebrowColor 'auto' | #RRGGBB
 *
 * Only clients that declare `promo_style@1` receive any of it (as `primary.style`, `surface`,
 * `eyebrowColor` with every value resolved). Everyone else gets the payload shipped apps already
 * decode, byte for byte — including no `theme.accent` (Android-only semantics; see the spec §6).
 *
 * Validation (admin save AND every send): hex format; label vs EVERY fill stop ≥ 4.5:1; the button
 * must stand out from the card it sits on (ΔE + contrast against every background stop); a custom
 * eyebrow ≥ 4.5:1 on the surface. A variant that fails at send time is replaced by the default look.
 */
import { z } from 'zod';

import { ICON_KEYS } from '../design/icons';
import { bucketOf } from '../experiments/bucket';

import { contrastRatio, deltaE, isHex, mixHex } from './color';
import type { CardSurface, PromoLayout, PromoProps, PromoTheme, WireButtonStyle } from './types';

// ---------------------------------------------------------------------------- capability

/** Client feature that unlocks button styles + surface + eyebrow colour. */
export const PROMO_STYLE_FEATURE = 'promo_style';
export const PROMO_STYLE_VERSION = 1;
/** Query param carrying versioned promo features (`features=promo_style@1`). */
export const PROMO_FEATURES_PARAM = 'features';

const TOKEN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Versioned feature tokens from any number of comma lists (`features=` query, X-Client-Features header):
 * `name@n` or bare `name` (= version 1). Unknown junk is ignored. Never defaults anything on.
 */
export function parseFeatureTokens(...lists: Array<string | null | undefined>): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of lists) {
    for (const t of (raw ?? '').split(',').slice(0, 32)) {
      const [name, v, ...rest] = t.trim().toLowerCase().split('@');
      if (rest.length || !TOKEN.test(name ?? '')) continue;
      const version = v === undefined ? 1 : /^\d{1,3}$/.test(v) ? Number(v) : 0;
      if (version < 1) continue;
      out.set(name, Math.max(out.get(name) ?? 0, version));
    }
  }
  return out;
}

export function supportsPromoStyle(features: Map<string, number> | undefined): boolean {
  return (features?.get(PROMO_STYLE_FEATURE) ?? 0) >= PROMO_STYLE_VERSION;
}

// ---------------------------------------------------------------------------- tokens + presets

/** Home card surface (iOS AppTheme.Colors.surface1, Android AppTheme surface1). The `dark` surface. */
export const DARK_SURFACE = '#11162A';
/** Text on the dark surface (iOS/Android textPrimary / textSecondary). */
export const DARK_SURFACE_TEXT = '#F5F7FF';
export const DARK_SURFACE_SUBTEXT = '#AEB6CC';
/** Brand eyebrow on the dark surface (accentViolet; 6.9:1 on #11162A). */
export const BRAND_EYEBROW = '#A78BFA';
/** Label colours `text: 'auto'` chooses between (the white pill's #111111 and white). */
export const LABEL_DARK = '#111111';
export const LABEL_LIGHT = '#FFFFFF';

export const CARD_SURFACES = ['gradient', 'dark'] as const;
export const BUTTON_KINDS = ['white', 'solid', 'gradient'] as const;
export const BUTTON_PRESETS = ['white', 'paywall', 'brand_purple'] as const;
export type ButtonKind = (typeof BUTTON_KINDS)[number];
export type ButtonPreset = (typeof BUTTON_PRESETS)[number];

/** Default gradient angle: CSS degrees, 90 = leading → trailing (the paywall CTA). */
export const DEFAULT_GRADIENT_ANGLE = 90;

/**
 * Presets. `paywall` = the paywall's primary CTA exactly: iOS AppTheme.Gradients.brand / Android
 * Gradients.brand, #7C3AED → #DB2777 leading → trailing, white label (5.7 / 4.6 : 1).
 * `brand_purple` = brandFlat #7C3AED (white 5.7:1). `white` = today's hero pill.
 */
export const PRESETS: Record<ButtonPreset, { label: string; style: WireButtonStyle }> = {
  white: { label: 'White pill (today)', style: { kind: 'white', preset: 'white', fill: '#FFFFFF', text: LABEL_DARK } },
  paywall: { label: 'Paywall gradient', style: { kind: 'gradient', preset: 'paywall', gradient: { colors: ['#7C3AED', '#DB2777'], angle: 90 }, text: LABEL_LIGHT } },
  brand_purple: { label: 'Brand purple', style: { kind: 'solid', preset: 'brand_purple', fill: '#7C3AED', text: LABEL_LIGHT } },
};

/** Thresholds (spec §5). */
export const STYLE_THRESHOLDS = {
  /** WCAG AA for the 15–17 pt semibold label (not "large text"). */
  labelContrast: 4.5,
  eyebrowContrast: 4.5,
  /** Button vs card: below this contrast AND below blendDeltaE → blocked ("blends in"). */
  separationContrast: 1.5,
  blendDeltaE: 35,
  /** Below this contrast (but distinct hue) → warning: hue-only separation. */
  warnContrast: 1.5,
} as const;

// ---------------------------------------------------------------------------- schemas

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a #RRGGBB colour');
const hexOrAuto = z.union([z.literal('auto'), hex]);

export const cardSurfaceSchema = z.enum(CARD_SURFACES);

/** The resolved style on the wire (validated again in promoPropsSchema). */
export const wireButtonStyleSchema = z
  .object({
    kind: z.enum(BUTTON_KINDS),
    preset: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).optional(),
    fill: hex.optional(),
    gradient: z.object({ colors: z.array(hex).min(2).max(3), angle: z.number().int().min(0).max(359) }).strict().optional(),
    text: hex,
    icon: z.enum(ICON_KEYS).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.kind === 'gradient' ? !s.gradient || s.fill : !s.fill || s.gradient) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${s.kind} needs ${s.kind === 'gradient' ? 'gradient (and no fill)' : 'fill (and no gradient)'}` });
  });

/** What an admin authors for the button: a preset, or a custom kind. */
export const buttonStyleInputSchema = z
  .object({
    preset: z.enum(BUTTON_PRESETS).optional(),
    kind: z.enum(BUTTON_KINDS).optional(),
    fill: hex.optional(),
    gradient: z.object({ colors: z.array(hex).min(2, 'at least 2 stops').max(3, 'at most 3 stops'), angle: z.number().int().min(0).max(359).optional() }).strict().optional(),
    text: hexOrAuto.optional(),
    icon: z.enum(ICON_KEYS).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const issue = (message: string, path: string[] = []) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    if (b.preset && b.kind) return issue('choose a preset or a custom style, not both');
    if (!b.preset && !b.kind) return issue('choose a preset or a custom style');
    if (b.preset && (b.fill || b.gradient)) return issue('presets have fixed colours; switch to a custom style to change them');
    if (b.kind === 'solid' && !b.fill) issue('a solid button needs a fill colour', ['fill']);
    if (b.kind === 'gradient' && !b.gradient) issue('a gradient button needs 2–3 stops', ['gradient']);
    if (b.kind !== 'solid' && b.fill) issue('only a solid button takes a fill colour', ['fill']);
    if (b.kind !== 'gradient' && b.gradient) issue('only a gradient button takes stops', ['gradient']);
  });
export type ButtonStyleInput = z.infer<typeof buttonStyleInputSchema>;

export const appearanceSchema = z
  .object({
    surface: cardSurfaceSchema.default('gradient'),
    button: buttonStyleInputSchema,
    eyebrowColor: hexOrAuto.optional(),
  })
  .strict();
export type PromoAppearance = z.infer<typeof appearanceSchema>;

export const styleVariantSchema = appearanceSchema
  .extend({
    /** Short id, appended to the creative id while an A/B test runs (`<creative>_s<id>`). */
    id: z.string().regex(/^[a-z][a-z0-9]{0,7}$/, 'a–z / 0–9, starting with a letter, ≤ 8'),
    /** Share of capable users (weights are relative). */
    weight: z.number().int().min(0).max(100),
  })
  .strict();
export type StyleVariant = z.infer<typeof styleVariantSchema>;

export const styleSettingSchema = z
  .object({ variants: z.array(styleVariantSchema).min(1).max(3) })
  .strict()
  .superRefine((s, ctx) => {
    const ids = s.variants.map((v) => v.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variants'], message: 'variant ids must be unique' });
    if (s.variants.reduce((n, v) => n + v.weight, 0) <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variants'], message: 'at least one variant needs a weight above 0' });
  });
export type StyleSetting = z.infer<typeof styleSettingSchema>;

/** Today's look: gradient card + white pill. What capable clients get when nothing is set. */
export const DEFAULT_APPEARANCE: PromoAppearance = { surface: 'gradient', button: { preset: 'white' } };

/** Ready-made looks the admin editor offers ("Paywall style" = variant B of the owner's test). */
export const LOOK_PRESETS: Record<'today' | 'paywall_style' | 'brand_purple', { label: string; appearance: PromoAppearance }> = {
  today: { label: 'Today: gradient card + white button', appearance: DEFAULT_APPEARANCE },
  paywall_style: { label: 'Paywall style: dark card + paywall gradient button + brand eyebrow', appearance: { surface: 'dark', button: { preset: 'paywall' }, eyebrowColor: BRAND_EYEBROW } },
  brand_purple: { label: 'Dark card + brand purple button', appearance: { surface: 'dark', button: { preset: 'brand_purple' } } },
};

// ---------------------------------------------------------------------------- resolve

/** Fill stops of a resolved style (white/solid: one). */
export const fillStops = (s: WireButtonStyle): string[] => (s.kind === 'gradient' ? s.gradient!.colors : [s.fill!]);

/** The label colour with the best worst-case contrast over the stops. */
export function autoLabel(stops: readonly string[]): string {
  const worst = (c: string) => Math.min(...stops.map((s) => contrastRatio(c, s)));
  return worst(LABEL_LIGHT) >= worst(LABEL_DARK) ? LABEL_LIGHT : LABEL_DARK;
}

/** Admin input → the wire style (preset expanded, angle defaulted, `auto` label resolved). Input must be schema-valid. */
export function resolveButtonStyle(input: ButtonStyleInput): WireButtonStyle {
  let out: WireButtonStyle;
  if (input.preset) out = structuredClone(PRESETS[input.preset].style);
  else if (input.kind === 'gradient') out = { kind: 'gradient', gradient: { colors: input.gradient!.colors.map((c) => c.toUpperCase()), angle: input.gradient!.angle ?? DEFAULT_GRADIENT_ANGLE }, text: LABEL_LIGHT };
  else if (input.kind === 'solid') out = { kind: 'solid', fill: input.fill!.toUpperCase(), text: LABEL_LIGHT };
  else out = { kind: 'white', fill: '#FFFFFF', text: LABEL_DARK };
  if (input.text && input.text !== 'auto') out.text = input.text.toUpperCase();
  else if (input.text === 'auto' || (!input.preset && input.kind !== 'white')) out.text = autoLabel(fillStops(out));
  if (input.icon) out.icon = input.icon;
  return out;
}

/** The colours the card is drawn with under `surface` (what the button sits on). */
export function surfaceStops(surface: CardSurface, theme: PromoTheme): string[] {
  if (surface === 'dark') return [DARK_SURFACE];
  return theme.background.kind === 'solid' ? [theme.background.color] : theme.background.colors;
}

function midOf(stops: readonly string[]): string {
  if (stops.length % 2 === 1) return stops[(stops.length - 1) / 2];
  return mixHex(stops[stops.length / 2 - 1], stops[stops.length / 2]);
}

// ---------------------------------------------------------------------------- checks

export interface StyleIssue {
  level: 'error' | 'warning';
  /** Dot path relative to the appearance / variant (`button.text`, `surface`, `eyebrowColor`). */
  path: string;
  message: string;
}

/** One decimal, except when rounding would hide a failure (4.49 → "4.49:1", never "4.5:1"). */
const fmt = (r: number) => {
  const one = Math.round(r * 10) / 10;
  const hides = [4.5, 1.5].some((t) => r < t && one >= t);
  return `${hides ? (Math.floor(r * 100) / 100).toFixed(2) : one.toFixed(1)}:1`;
};

/**
 * Contrast + separation checks for one look on one creative (its theme and layout). Errors block publish
 * (and are replaced by the default look at send time); warnings are shown to the admin only.
 */
export function checkAppearance(a: PromoAppearance, card: { theme: PromoTheme; layout: PromoLayout }): StyleIssue[] {
  const out: StyleIssue[] = [];
  // A variant carries id/weight too; only the look is checked here.
  const { id: _id, weight: _weight, ...lookOnly } = a as PromoAppearance & { id?: unknown; weight?: unknown };
  const parsed = appearanceSchema.safeParse(lookOnly);
  if (!parsed.success) return parsed.error.issues.map((i) => ({ level: 'error' as const, path: i.path.join('.'), message: i.message }));
  const look = parsed.data;
  const surface = look.surface;
  const style = resolveButtonStyle(look.button);
  const stops = fillStops(style);
  const bg = surfaceStops(surface, card.theme);
  const T = STYLE_THRESHOLDS;
  const hero = card.layout === 'hero';
  const isDefaultButton = style.kind === 'white' && style.text === LABEL_DARK;

  if (hero) {
    // 1. Label on every stop.
    for (const s of stops) {
      const r = contrastRatio(style.text, s);
      if (r < T.labelContrast) {
        out.push({
          level: 'error',
          path: 'button.text',
          message: `Label ${style.text} on ${stops.length > 1 ? `gradient stop ${s}` : s} is ${fmt(r)}; it needs at least 4.5:1. ${look.button.text && look.button.text !== 'auto' ? 'Try "Auto" or another label colour' : 'Pick lighter or darker stops'}.`,
        });
      }
    }
    // 2. The button must stand out from the card it sits on.
    let blended: string | null = null;
    let hueOnly: string | null = null;
    for (const f of stops) {
      for (const b of bg) {
        const r = contrastRatio(f, b);
        if (r >= T.warnContrast) continue;
        const d = deltaE(f, b);
        if (r < T.separationContrast && d < T.blendDeltaE) blended ??= `${f} vs the card's ${b} (${fmt(r)}, ΔE ${Math.round(d)})`;
        else hueOnly ??= `${f} vs ${b} (${fmt(r)})`;
      }
    }
    if (blended) out.push({ level: 'error', path: 'button', message: `The button blends into the card: ${blended}. Use the dark surface, a white button, or a clearly different colour.` });
    else if (hueOnly) out.push({ level: 'warning', path: 'button', message: `The button differs from the card by hue only: ${hueOnly}. Hard to see for colour-blind users; prefer more light/dark contrast.` });
  } else if (!isDefaultButton) {
    out.push({ level: 'warning', path: 'button', message: `${card.layout === 'banner' ? 'Banner' : 'Compact'} cards have no filled button, so the button style isn't drawn. The surface and eyebrow colour still apply.` });
  }

  // 3. Eyebrow colour on the surface.
  if (look.eyebrowColor && look.eyebrowColor !== 'auto') {
    if (card.layout === 'compact') {
      out.push({ level: 'warning', path: 'eyebrowColor', message: 'Compact cards draw no eyebrow; the colour is not shown.' });
    } else {
      const on = surface === 'dark' ? DARK_SURFACE : midOf(bg);
      const r = contrastRatio(look.eyebrowColor, on);
      if (r < T.eyebrowContrast) out.push({ level: 'error', path: 'eyebrowColor', message: `Eyebrow ${look.eyebrowColor.toUpperCase()} on the card (${on}) is ${fmt(r)}; it needs at least 4.5:1.` });
    }
  }
  return out;
}

/** checkAppearance over every variant × creative; paths prefixed `variants.<i>.`. Deduplicated. */
export function checkStyleSetting(setting: StyleSetting, cards: ReadonlyArray<{ theme: PromoTheme; layout: PromoLayout; label?: string }>): StyleIssue[] {
  const out: StyleIssue[] = [];
  const seen = new Set<string>();
  setting.variants.forEach((v, i) => {
    for (const card of cards) {
      for (const issue of checkAppearance(v, card)) {
        const message = cards.length > 1 && card.label ? `${card.label}: ${issue.message}` : issue.message;
        const key = `${issue.level}|${i}|${issue.path}|${message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...issue, path: `variants.${i}.${issue.path}`, message: setting.variants.length > 1 ? `Variant ${v.id.toUpperCase()}: ${message}` : message });
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------- apply

/** Deterministic variant for this user (salt `<promoKey>:style`, independent of the copy A/B). */
export function pickStyleVariant(setting: StyleSetting, promoKey: string, userId: string): StyleVariant {
  const total = setting.variants.reduce((n, v) => n + Math.max(0, v.weight), 0);
  const bucket = bucketOf(userId, `${promoKey}:style`);
  let upper = 0;
  for (const v of setting.variants) {
    upper += (Math.max(0, v.weight) / total) * 100;
    if (bucket < upper) return v;
  }
  return setting.variants[setting.variants.length - 1];
}

/** props + a look → the promo_style@1 props (style only on a hero primary; surface always; eyebrow when custom). */
export function applyAppearance(props: PromoProps, look: PromoAppearance): PromoProps {
  const out: PromoProps = { ...props, primary: { ...props.primary }, surface: look.surface ?? 'gradient' };
  if (props.layout === 'hero') out.primary.style = resolveButtonStyle(look.button);
  if (look.eyebrowColor && look.eyebrowColor !== 'auto' && isHex(look.eyebrowColor) && props.layout !== 'compact') out.eyebrowColor = look.eyebrowColor.toUpperCase();
  return out;
}

export interface StyledResult {
  props: PromoProps;
  /** The variant drawn (null = default look: nothing configured, or the variant failed its checks). */
  variantId: string | null;
  /** Why the configured variant was not used. */
  rejected?: string;
}

/**
 * For a promo_style@1 client: pick the variant, check it against THIS creative, apply it. While an A/B
 * test runs (≥ 2 variants) the creative id gets `_s<variant>` so events split by look. A failing variant
 * falls back to the default look (unsuffixed creative id) instead of dropping the promo.
 */
export function styledProps(promoKey: string, props: PromoProps, setting: StyleSetting | null | undefined, userId: string): StyledResult {
  if (!setting) return { props: applyAppearance(props, DEFAULT_APPEARANCE), variantId: null };
  const parsed = styleSettingSchema.safeParse(setting);
  if (!parsed.success) return { props: applyAppearance(props, DEFAULT_APPEARANCE), variantId: null, rejected: 'invalid_setting' };
  const variant = pickStyleVariant(parsed.data, promoKey, userId);
  const errors = checkAppearance(variant, { theme: props.theme, layout: props.layout }).filter((i) => i.level === 'error');
  if (errors.length) {
    console.warn(`[promos] ${promoKey}/${props.creativeId} style ${variant.id} rejected: ${errors.map((e) => e.message).join(' ')}`);
    return { props: applyAppearance(props, DEFAULT_APPEARANCE), variantId: null, rejected: 'contrast' };
  }
  const styled = applyAppearance(props, variant);
  const testing = parsed.data.variants.filter((v) => v.weight > 0).length > 1;
  if (testing) {
    const id = `${props.creativeId}_s${variant.id}`;
    if (id.length <= 60) styled.creativeId = id;
  }
  return { props: styled, variantId: variant.id };
}
