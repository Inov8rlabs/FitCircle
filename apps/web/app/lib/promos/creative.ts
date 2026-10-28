/**
 * Creative validation + the promo@1 `props` builder (PROMO_CARD_SPEC §3).
 * Text is plain, trimmed and length-checked; colours are #RRGGBB; the text
 * colour must reach 4.5:1 contrast against the background's mid colour.
 */
import { z } from 'zod';

import { ICON_KEYS } from '@/lib/design/icons';

import { resolveAction } from './actions';
import { PROMO_LAYOUTS, type PromoCreative, type PromoProps, type PromoTheme, type WireAction } from './types';

export const TEXT_LIMITS = { eyebrow: 28, title: 44, body: 120, badge: 12, label: 24 } as const;

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const text = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max).refine((s) => !/[<>]|\]\(|```/.test(s), 'plain text only (no HTML / Markdown)'));

const themeSchema = z
  .object({
    background: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('gradient'), colors: z.array(hex).min(2).max(4) }).strict(),
      z.object({ kind: z.literal('solid'), color: hex }).strict(),
    ]),
    accent: hex.optional(),
    foreground: z.enum(['light', 'dark']),
  })
  .strict();

const wireAction = z.object({ type: z.string().min(1), params: z.record(z.unknown()) }).strict();
const button = z.object({ label: text(TEXT_LIMITS.label), action: wireAction }).strict();

/** Wire `props` of a promo@1 card. */
export const promoPropsSchema = z
  .object({
    promoId: z.string().regex(/^[a-z0-9_]{3,60}$/),
    creativeId: z.string().regex(/^[a-z0-9_]{1,60}$/),
    layout: z.enum(PROMO_LAYOUTS),
    theme: themeSchema,
    icon: z.enum(ICON_KEYS).optional(),
    emoji: z.string().min(1).max(8).optional(),
    image: z
      .object({
        url: z.string().url().startsWith('https://'),
        darkUrl: z.string().url().startsWith('https://').nullable().optional(),
        aspect: z.enum(['16:9', '1:1']),
        focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
        alt: z.string().min(1).max(200),
      })
      .strict()
      .optional(),
    eyebrow: text(TEXT_LIMITS.eyebrow).optional(),
    title: text(TEXT_LIMITS.title),
    body: text(TEXT_LIMITS.body).optional(),
    badge: z.object({ text: text(TEXT_LIMITS.badge), tone: z.string().regex(/^[a-z]{2,16}$/) }).strict().optional(),
    countdown: z.object({ endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/), label: text(20) }).strict().optional(),
    primary: button,
    secondary: button.optional(),
    dismissible: z.boolean(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.layout !== 'hero' && p.secondary) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${p.layout} has a primary button only` });
    if (p.layout === 'compact' && p.image) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'compact has no image' });
    if (p.image && p.image.aspect !== (p.layout === 'hero' ? '16:9' : '1:1')) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'image aspect does not match the layout' });
    if (!contrastOk(p.theme)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'text contrast below 4.5:1 against the background' });
  });

// ---------------------------------------------------------------------------- contrast

function luminance(hexColor: string): number {
  const n = parseInt(hexColor.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** The gradient's mid colour (middle stop; average of the two middle stops for an even count). */
export function midColor(theme: PromoTheme): string {
  const bg = theme.background;
  if (bg.kind === 'solid') return bg.color;
  const c = bg.colors;
  if (c.length % 2 === 1) return c[(c.length - 1) / 2];
  const [a, b] = [c[c.length / 2 - 1], c[c.length / 2]].map((h) => parseInt(h.slice(1), 16));
  const mix = (sh: number) => Math.round((((a >> sh) & 255) + ((b >> sh) & 255)) / 2);
  return `#${[16, 8, 0].map((sh) => mix(sh).toString(16).padStart(2, '0')).join('')}`;
}

export function contrastOk(theme: PromoTheme, min = 4.5): boolean {
  const fg = theme.foreground === 'light' ? '#FFFFFF' : '#111111';
  return contrastRatio(fg, midColor(theme)) >= min;
}

// ---------------------------------------------------------------------------- placeholders

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;
export const KNOWN_PLACEHOLDERS = ['first_name', 'days_left', 'circle_name', 'streak'] as const;

/** Resolve `{{name}}` placeholders; null when one is unknown or empty (the creative is then unusable). */
export function fillPlaceholders(textIn: string, vars: Partial<Record<(typeof KNOWN_PLACEHOLDERS)[number], string | number | null>>): string | null {
  let ok = true;
  const out = textIn.replace(PLACEHOLDER, (_m, name: string) => {
    const v = (vars as Record<string, unknown>)[name];
    if (!(KNOWN_PLACEHOLDERS as readonly string[]).includes(name) || v === null || v === undefined || String(v).trim() === '') {
      ok = false;
      return '';
    }
    return String(v);
  });
  return ok ? out : null;
}

// ---------------------------------------------------------------------------- builder

/**
 * Creative → wire props for this client: resolves both buttons (fallback
 * chain), drops an unresolvable secondary, and returns null when the primary
 * can't be resolved or the result fails validation.
 */
export function buildPromoProps(promoKey: string, creative: PromoCreative, actions: Map<string, number>): PromoProps | null {
  const primary = resolveAction(creative.primary.action, actions);
  if (!primary) return null;
  let secondary: { label: string; action: WireAction } | undefined;
  if (creative.secondary && creative.layout === 'hero') {
    const a = resolveAction(creative.secondary.action, actions);
    if (a) secondary = { label: creative.secondary.label, action: a };
  }
  const props: PromoProps = {
    promoId: promoKey,
    creativeId: creative.id,
    layout: creative.layout,
    theme: creative.theme,
    ...(creative.icon ? { icon: creative.icon } : {}),
    ...(creative.emoji ? { emoji: creative.emoji } : {}),
    ...(creative.image ? { image: creative.image } : {}),
    ...(creative.eyebrow ? { eyebrow: creative.eyebrow } : {}),
    title: creative.title,
    ...(creative.body ? { body: creative.body } : {}),
    ...(creative.badge ? { badge: creative.badge } : {}),
    ...(creative.countdown ? { countdown: creative.countdown } : {}),
    primary: { label: creative.primary.label, action: primary },
    ...(secondary ? { secondary } : {}),
    dismissible: creative.dismissible,
  };
  const parsed = promoPropsSchema.safeParse(props);
  if (!parsed.success) {
    console.warn(`[promos] ${promoKey}/${creative.id} dropped (invalid props): ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    return null;
  }
  return parsed.data as PromoProps;
}
