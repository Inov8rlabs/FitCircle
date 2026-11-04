/**
 * Pro lifecycle prompts — configuration.
 *
 * Stored in ONE feature_flags row (no migration, same pattern as
 * app_update_policy / migration 121):
 *   name       'pro_lifecycle_prompts'
 *   is_enabled admin master switch (false → no cards, no pushes)
 *   metadata   ProLifecycleConfig (validated by proLifecycleConfigSchema)
 * A missing row, a read error or an invalid metadata blob → DEFAULT_CONFIG.
 * Written only by the Admin Tools "Pro lifecycle" editor (publish = audited).
 *
 * Env:
 *   PRO_ENDING_PROMPTS_ENABLED  default ON; "false" | "0" | "off" | "no" turns
 *                               every card and push off (kill switch).
 *   PRO_ENDING_PUSH_DRY_RUN     default OFF; "true" → the crons compute and log
 *                               what they would send but never send.
 * Cards additionally need PROMOS_ENABLED (promo@1) like every promo.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { PROMO_LAYOUTS } from '../promos/types';

import { PRO_LIFECYCLE_STATES, type ProLifecycleConfig, type ProLifecycleState, type StateConfig } from './types';

export const CONFIG_FLAG_NAME = 'pro_lifecycle_prompts';
/** experiment_audit_log key for config publishes (layers use `layer:<key>`). */
export const CONFIG_AUDIT_KEY = `config:${CONFIG_FLAG_NAME}`;

type Env = Record<string, string | undefined>;
const OFF = new Set(['0', 'false', 'off', 'no']);
const ON = new Set(['1', 'true', 'on', 'yes']);

export function promptsEnabled(env: Env = process.env): boolean {
  return !OFF.has((env.PRO_ENDING_PROMPTS_ENABLED ?? '').trim().toLowerCase());
}

export function pushDryRunForced(env: Env = process.env): boolean {
  return ON.has((env.PRO_ENDING_PUSH_DRY_RUN ?? '').trim().toLowerCase());
}

/** Text limits: promo@1 limits (creative.ts TEXT_LIMITS) for the card, push limits for the notification. */
export const COPY_LIMITS = {
  eyebrow: 28,
  title: 44,
  body: 120,
  label: 24,
  pushTitle: 60,
  pushBody: 178,
} as const;

/** Timing bounds the editor and the schema enforce. */
export const TIMING_LIMITS = {
  hoursBefore: { min: 6, max: 168 },
  daysAfter: { min: 1, max: 30 },
  snoozeDays: { min: 0, max: 30 },
} as const;

const plain = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(1, 'required')
        .max(max, `at most ${max} characters`)
        .refine((s) => !/[<>]|\]\(|```/.test(s), 'plain text only (no HTML / Markdown)')
    );

const stateCopySchema = z
  .object({
    eyebrow: plain(COPY_LIMITS.eyebrow),
    title: plain(COPY_LIMITS.title + 20), // placeholders expand; the rendered length is checked on render
    body: plain(COPY_LIMITS.body + 20),
    usageBody: plain(COPY_LIMITS.body + 20).refine((s) => s.includes('{{usage}}'), 'must contain {{usage}}'),
    cta: plain(COPY_LIMITS.label),
    ctaNoTrial: plain(COPY_LIMITS.label),
  })
  .strict();

const pushCopySchema = z
  .object({
    enabled: z.boolean(),
    title: plain(COPY_LIMITS.pushTitle),
    body: plain(COPY_LIMITS.pushBody),
    bodyNoTrial: plain(COPY_LIMITS.pushBody),
  })
  .strict();

const stateSchema = z
  .object({
    enabled: z.boolean(),
    layout: z.enum(PROMO_LAYOUTS),
    copy: stateCopySchema,
    hoursBefore: z.number().int().min(TIMING_LIMITS.hoursBefore.min).max(TIMING_LIMITS.hoursBefore.max),
    daysAfter: z.number().int().min(TIMING_LIMITS.daysAfter.min).max(TIMING_LIMITS.daysAfter.max),
    snoozeDays: z.number().int().min(TIMING_LIMITS.snoozeDays.min).max(TIMING_LIMITS.snoozeDays.max),
    push: pushCopySchema,
  })
  .strict();

export const proLifecycleConfigSchema = z
  .object({
    version: z.literal(1),
    states: z.object({ pro_expiring: stateSchema, pro_expired: stateSchema, trial_expiring: stateSchema }).strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.states.trial_expiring.push.enabled) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['states', 'trial_expiring', 'push', 'enabled'], message: 'store trials already get the "trial ends tomorrow" push (trial_ending_reminder); this state is card-only' });
    }
  });

// ---------------------------------------------------------------------------- defaults

/**
 * Default copy. Honest: Pro really includes unlimited AI meal scans
 * (food_ai_unlimited), full history (history_extended), no ads (ads_removed)
 * and Fitzy's weekly plan + memory (Pro by tier). The 3-day free trial is
 * only promised in the CTA / push variant used when the trial is available.
 */
export const DEFAULT_CONFIG: ProLifecycleConfig = {
  version: 1,
  states: {
    pro_expiring: {
      enabled: true,
      layout: 'hero',
      copy: {
        eyebrow: 'FitCircle Pro',
        title: 'Your {{period}} ends {{ends}}',
        body: 'Keep unlimited AI meal scans, your full history and weekly plans from Fitzy.',
        usageBody: 'So far with Pro: {{usage}}. Keep the momentum going.',
        cta: 'Start 3-day free trial',
        ctaNoTrial: 'Keep Pro',
      },
      hoursBefore: 48,
      daysAfter: 7,
      snoozeDays: 1,
      push: {
        enabled: true,
        title: 'Your {{period}} ends {{ends}}',
        body: 'Keep unlimited AI meal scans and weekly plans from Fitzy. Start your 3-day free trial in the app.',
        bodyNoTrial: 'Keep unlimited AI meal scans and weekly plans from Fitzy. Keep Pro from your Home screen.',
      },
    },
    pro_expired: {
      enabled: true,
      layout: 'hero',
      copy: {
        eyebrow: 'FitCircle Pro',
        title: 'Your {{period}} ended',
        body: 'Get back unlimited AI meal scans, your full history and weekly plans from Fitzy.',
        usageBody: 'With Pro you got {{usage}}. Pick up right where you left off.',
        cta: 'Get Pro: 3 days free',
        ctaNoTrial: 'Get Pro back',
      },
      hoursBefore: 48,
      daysAfter: 7,
      snoozeDays: 3,
      push: {
        enabled: true,
        title: 'Your {{period}} ended',
        body: 'Thanks for trying Pro. Get it back with a 3-day free trial, right from your Home screen.',
        bodyNoTrial: 'Thanks for trying Pro. You can get it back anytime from your Home screen.',
      },
    },
    trial_expiring: {
      enabled: false,
      layout: 'hero',
      copy: {
        eyebrow: 'FitCircle Pro',
        title: 'Your {{period}} ends {{ends}}',
        body: 'Renewal is off. Keep Pro to hold on to unlimited AI meal scans and your full history.',
        usageBody: 'So far with Pro: {{usage}}. Keep Pro to keep it going.',
        cta: 'Keep Pro',
        ctaNoTrial: 'Keep Pro',
      },
      hoursBefore: 24,
      daysAfter: 7,
      snoozeDays: 1,
      push: {
        enabled: false,
        title: 'Your Pro trial ends {{ends}}',
        body: 'Keep Pro from your Home screen.',
        bodyNoTrial: 'Keep Pro from your Home screen.',
      },
    },
  },
};

export const STATE_LABELS: Record<ProLifecycleState, { label: string; description: string }> = {
  pro_expiring: {
    label: 'Pro ending soon',
    description: 'Free Pro from referrals or a complimentary grant that ends within the window. Card + one push at 10:00 local the day before.',
  },
  pro_expired: {
    label: 'Pro ended',
    description: 'Free Pro that ended in the last N days; the user is free now and never paid. Card + one push right after the downgrade.',
  },
  trial_expiring: {
    label: 'Store trial ending',
    description: 'App Store / Play trial with renewal turned off, ending within the window. Card only: the "trial ends tomorrow" push already exists.',
  },
};

/** Parse a stored blob: valid → it, else null (the caller falls back to defaults). */
export function parseConfig(raw: unknown): ProLifecycleConfig | null {
  const parsed = proLifecycleConfigSchema.safeParse(raw);
  return parsed.success ? (parsed.data as ProLifecycleConfig) : null;
}

/** Validate a draft: the config + issues (path → message). */
export function validateConfig(raw: unknown): { config: ProLifecycleConfig | null; issues: Array<{ path: string; message: string }> } {
  const parsed = proLifecycleConfigSchema.safeParse(raw);
  if (parsed.success) return { config: parsed.data as ProLifecycleConfig, issues: [] };
  return { config: null, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })) };
}

/** Stable JSON (sorted keys) for hashing / diffing. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Content version of (master switch, config): the editor's baseVersion for optimistic concurrency. */
export function configVersion(enabled: boolean, config: ProLifecycleConfig): string {
  return `pl1-${createHash('sha256').update(stableJson({ enabled, config })).digest('hex').slice(0, 16)}`;
}

/** Field-level differences (dot paths) between two configs, for the publish summary + audit. */
export function diffConfigs(before: ProLifecycleConfig, after: ProLifecycleConfig): Array<{ path: string; before: unknown; after: unknown }> {
  const out: Array<{ path: string; before: unknown; after: unknown }> = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      }
      return;
    }
    if (stableJson(a) !== stableJson(b)) out.push({ path, before: a, after: b });
  };
  walk(before, after, '');
  return out;
}

export function stateConfig(config: ProLifecycleConfig, state: ProLifecycleState): StateConfig {
  return config.states[state];
}

