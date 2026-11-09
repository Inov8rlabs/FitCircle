/**
 * Looks (button style + card surface) for the code-defined system promos (system-promos.ts), edited in
 * Admin Tools → Home feed → Promo looks. Pure; I/O is in services/promo-style-service.ts.
 *
 * Stored in ONE feature_flags row (no migration — same pattern as pro_lifecycle_prompts):
 *   name       'promo_styles'
 *   is_enabled true (unused; the env kill switch below is the off switch)
 *   metadata   PromoStylesConfig (validated by promoStylesConfigSchema)
 * Missing row / read error / invalid blob → no styles (every promo keeps today's look).
 * Pro lifecycle states carry their own `style` in the pro_lifecycle_prompts config.
 *
 * Env: PROMO_STYLES_ENABLED default ON; "false" | "0" | "off" | "no" → promo_style@1 clients get the
 * default look for every promo (lifecycle states included). Shipped clients are unaffected either way.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { DEFAULT_MEAL_REMINDER_PREFS, slotForMinutes } from '../journey/meal-slots';

import type { CreativeOption, PromoDefinition, PromoMatchInput } from './engine';
import { checkStyleSetting, styleSettingSchema, type StyleIssue, type StyleSetting } from './style';
import { SYSTEM_PROMOS } from './system-promos';
import type { PromoLayout, PromoTheme } from './types';

export const PROMO_STYLES_FLAG = 'promo_styles';
export const PROMO_STYLES_AUDIT_KEY = `config:${PROMO_STYLES_FLAG}`;

type Env = Record<string, string | undefined>;
const OFF = new Set(['0', 'false', 'off', 'no']);

export function promoStylesEnabled(env: Env = process.env): boolean {
  return !OFF.has((env.PROMO_STYLES_ENABLED ?? '').trim().toLowerCase());
}

/** Admin labels for the system promos. */
export const SYSTEM_PROMO_LABELS: Record<string, { label: string; description: string }> = {
  first_meal: { label: 'Snap your first meal', description: 'New members with no meal logged yet (hero, under the header).' },
  log_meal_now: { label: 'Log this meal', description: 'The open meal slot right now, not yet logged today (banner).' },
  pro_value: { label: 'Pro value', description: 'Free members ≥ 18 h after sign-up with a meal logged; 3 copy variants (banner, opens the paywall).' },
  meet_fitzy: { label: 'Meet Fitzy', description: 'Members who logged a meal but never opened Fitzy (banner). Free members get no-chat copy (chat is Pro); Pro members get the prefilled chat prompt.' },
  fitzy_recommendations: {
    label: 'Fitzy recommendations',
    description:
      'Trial-first teaser from session 1: free members with onboarding complete, a goal set and a real Fitzy plan preview (made at onboarding completion). Trial copy when trial-eligible; replaces pro_value and meet_fitzy while it shows (banner, opens the paywall).',
  },
};

export const SYSTEM_PROMO_STYLE_KEYS = SYSTEM_PROMOS.map((p) => p.key) as [string, ...string[]];

export interface PromoStylesConfig {
  version: 1;
  /** promo key → look variants. A key that is absent keeps today's look. */
  promos: Record<string, StyleSetting>;
}

export const DEFAULT_PROMO_STYLES: PromoStylesConfig = { version: 1, promos: {} };

/** A representative match input so each system promo returns its creatives (themes + layouts) for checks and previews. */
export function sampleMatchInput(now: Date = new Date()): PromoMatchInput {
  const localMinutes = 12 * 60 + 30;
  return {
    ctx: { now, userId: '00000000-0000-4000-8000-000000000000' } as PromoMatchInput['ctx'],
    journey: {
      hasLoggedMeal: true,
      loggedSlotsToday: [],
      lastMeal: { title: 'Grilled chicken salad', mealType: 'lunch' },
      signupAt: new Date(now.getTime() - 5 * 86_400_000).toISOString(),
      fitzyOpenedAt: null,
      mealReminderPrefs: { ...DEFAULT_MEAL_REMINDER_PREFS },
      localMinutes: slotForMinutes(localMinutes) ? localMinutes : 12 * 60,
      fitzyRecommendationsReady: true,
      trialEligible: true,
      fitzyPlanReady: true,
    },
    liveProFeatures: new Set(['food_ai_unlimited', 'history_extended', 'ads_removed']),
  };
}

/** Every creative a system promo can show (sample input), with its theme + layout. */
export function systemPromoCreatives(def: PromoDefinition, input: PromoMatchInput = sampleMatchInput()): CreativeOption[] {
  try {
    return def.creatives(input);
  } catch {
    return [];
  }
}

export function systemPromoCards(key: string): Array<{ id: string; theme: PromoTheme; layout: PromoLayout; label: string }> {
  const def = SYSTEM_PROMOS.find((d) => d.key === key);
  if (!def) return [];
  return systemPromoCreatives(def).map((c) => ({ id: c.id, theme: c.theme, layout: c.layout, label: c.id }));
}

/** Style checks (errors + warnings) for every promo × creative, with full paths `promos.<key>.variants.<i>…`. */
export function promoStylesIssues(config: PromoStylesConfig): Array<StyleIssue> {
  return Object.entries(config.promos).flatMap(([key, setting]) => checkStyleSetting(setting, systemPromoCards(key)).map((i) => ({ ...i, path: `promos.${key}.${i.path}` })));
}

export const promoStylesConfigSchema = z
  .object({
    version: z.literal(1),
    promos: z.record(z.enum(SYSTEM_PROMO_STYLE_KEYS), styleSettingSchema),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const i of promoStylesIssues(c as PromoStylesConfig)) {
      if (i.level === 'error') ctx.addIssue({ code: z.ZodIssueCode.custom, path: i.path.split('.'), message: i.message });
    }
  });

export function parsePromoStyles(raw: unknown): PromoStylesConfig | null {
  const parsed = promoStylesConfigSchema.safeParse(raw);
  return parsed.success ? (parsed.data as PromoStylesConfig) : null;
}

export function validatePromoStyles(raw: unknown): { config: PromoStylesConfig | null; issues: Array<{ path: string; message: string }>; warnings: Array<{ path: string; message: string }> } {
  const parsed = promoStylesConfigSchema.safeParse(raw);
  if (!parsed.success) return { config: null, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })), warnings: [] };
  const config = parsed.data as PromoStylesConfig;
  const warnings = promoStylesIssues(config)
    .filter((i) => i.level === 'warning')
    .map(({ path, message }) => ({ path, message }));
  return { config, issues: [], warnings };
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Content version (the editor's baseVersion for optimistic concurrency). */
export function promoStylesVersion(config: PromoStylesConfig): string {
  return `ps1-${createHash('sha256').update(stable(config)).digest('hex').slice(0, 16)}`;
}

/** Field-level differences (dot paths; a variant list is compared as one value per promo). */
export function diffPromoStyles(before: PromoStylesConfig, after: PromoStylesConfig): Array<{ path: string; before: unknown; after: unknown }> {
  const keys = [...new Set([...Object.keys(before.promos), ...Object.keys(after.promos)])].sort();
  return keys
    .filter((k) => stable(before.promos[k] ?? null) !== stable(after.promos[k] ?? null))
    .map((k) => ({ path: `promos.${k}`, before: before.promos[k] ?? null, after: after.promos[k] ?? null }));
}

/** System promo definitions with their published looks attached (styles off → none). */
export function withPromoStyles(defs: readonly PromoDefinition[], config: PromoStylesConfig | null | undefined): readonly PromoDefinition[] {
  if (!config || Object.keys(config.promos).length === 0) return defs;
  return defs.map((d) => (config.promos[d.key] ? { ...d, style: config.promos[d.key] } : d));
}
