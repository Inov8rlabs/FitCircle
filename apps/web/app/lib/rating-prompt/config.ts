/**
 * Store rating prompt — configuration (docs/RATING_PROMPT.md).
 *
 * Stored in ONE feature_flags row (no migration, same pattern as
 * pro_lifecycle_prompts / app_update_policy):
 *   name       'rating_prompt'
 *   is_enabled admin master switch (false → nobody is eligible)
 *   metadata   RatingPromptConfig (validated by ratingPromptConfigSchema)
 * A missing row, a read error or an invalid metadata blob → DEFAULT_CONFIG.
 * Written only by the Admin Tools "Rating prompt" editor (publish = audited).
 *
 * Env:
 *   RATING_PROMPT_ENABLED  default ON; "false" | "0" | "off" | "no" makes
 *                          every user ineligible (kill switch, no deploy of
 *                          the apps needed).
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

export const CONFIG_FLAG_NAME = 'rating_prompt';
/** experiment_audit_log key for config publishes. */
export const CONFIG_AUDIT_KEY = `config:${CONFIG_FLAG_NAME}`;

type Env = Record<string, string | undefined>;
const OFF = new Set(['0', 'false', 'off', 'no']);

export function envEnabled(env: Env = process.env): boolean {
  return !OFF.has((env.RATING_PROMPT_ENABLED ?? '').trim().toLowerCase());
}

/**
 * Trigger moments the apps know (1.1.2). The config may carry other keys
 * (room for new moments): unknown keys are served to clients, which ignore
 * keys they don't know.
 */
export const KNOWN_TRIGGERS = ['meal_saved', 'streak_reached', 'challenge_day_completed'] as const;
export type KnownTrigger = (typeof KNOWN_TRIGGERS)[number];

export const TRIGGER_LABELS: Record<KnownTrigger, { label: string; description: string }> = {
  meal_saved: { label: 'Meal saved', description: 'A new AI-analysed meal was saved, once meals are logged on the minimum number of distinct days.' },
  streak_reached: { label: 'Streak reached', description: 'The user reached one of the listed streak lengths.' },
  challenge_day_completed: { label: 'Challenge day completed', description: "Today's daily challenge was completed." },
};

export const LIMITS = {
  minDaysSinceSignup: { min: 0, max: 60 },
  minMealDays: { min: 1, max: 30 },
  cooldownDays: { min: 1, max: 365 },
  maxPromptsPerUser: { min: 1, max: 20 },
  recentErrorMinutes: { min: 0, max: 1440 },
  streakLength: { min: 1, max: 365 },
} as const;

const versionString = z.string().regex(/^\d+(\.\d+){0,3}$/, 'a version like 1.1.3');

const platformSchema = z.object({ enabled: z.boolean(), minAppVersion: versionString }).strict();

const triggerSchema = z
  .object({
    enabled: z.boolean(),
    /** streak_reached only: the streak lengths that ask. */
    streakLengths: z.array(z.number().int().min(LIMITS.streakLength.min).max(LIMITS.streakLength.max)).max(20).optional(),
  })
  .strict();

const int = (l: { min: number; max: number }) => z.number().int().min(l.min).max(l.max);

export const ratingPromptConfigSchema = z
  .object({
    version: z.literal(1),
    platforms: z.object({ ios: platformSchema, android: platformSchema }).strict(),
    triggers: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, 'snake_case key'), triggerSchema),
    minDaysSinceSignup: int(LIMITS.minDaysSinceSignup),
    minMealDays: int(LIMITS.minMealDays),
    cooldownDays: int(LIMITS.cooldownDays),
    maxPromptsPerUser: int(LIMITS.maxPromptsPerUser),
    exclusions: z
      .object({
        /** Client-enforced: no ask in a session that showed a paywall. */
        paywallSameSession: z.boolean(),
        /** Client-enforced: no ask on a day that showed a paywall. */
        paywallSameDay: z.boolean(),
        /** Client-enforced: no ask within N minutes of a user-visible error (0 = off). */
        recentErrorMinutes: int(LIMITS.recentErrorMinutes),
        /** Server-enforced: admins, our domains, reviewer / QA / Test Lab accounts never qualify. */
        internalAccounts: z.boolean(),
      })
      .strict(),
    audience: z
      .object({
        /** Deterministic per-user bucket (0–99) below this qualifies. */
        rolloutPercent: z.number().int().min(0).max(100),
        /** ISO alpha-2 (request IP country); empty = everywhere. */
        countries: z.array(z.string().regex(/^[A-Z]{2}$/, 'ISO country code like US')).max(250),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const streak = c.triggers.streak_reached;
    if (streak?.enabled && !(streak.streakLengths && streak.streakLengths.length > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['triggers', 'streak_reached', 'streakLengths'], message: 'list at least one streak length' });
    }
  });

export type RatingPromptConfig = z.infer<typeof ratingPromptConfigSchema>;

/** Code defaults: work with no row at all. */
export const DEFAULT_CONFIG: RatingPromptConfig = {
  version: 1,
  platforms: {
    ios: { enabled: true, minAppVersion: '1.1.2' },
    android: { enabled: true, minAppVersion: '1.1.2' },
  },
  triggers: {
    meal_saved: { enabled: true },
    streak_reached: { enabled: true, streakLengths: [3, 7] },
    challenge_day_completed: { enabled: true },
  },
  minDaysSinceSignup: 2,
  minMealDays: 3,
  cooldownDays: 120,
  maxPromptsPerUser: 3,
  exclusions: { paywallSameSession: true, paywallSameDay: false, recentErrorMinutes: 30, internalAccounts: true },
  audience: { rolloutPercent: 100, countries: [] },
};

export function parseConfig(raw: unknown): RatingPromptConfig | null {
  const parsed = ratingPromptConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function validateConfig(raw: unknown): { config: RatingPromptConfig | null; issues: Array<{ path: string; message: string }> } {
  const parsed = ratingPromptConfigSchema.safeParse(raw);
  if (parsed.success) return { config: parsed.data, issues: [] };
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
export function configVersion(enabled: boolean, config: RatingPromptConfig): string {
  return `rp1-${createHash('sha256').update(stableJson({ enabled, config })).digest('hex').slice(0, 16)}`;
}

/** Field-level differences (dot paths) between two configs. */
export function diffConfigs(before: unknown, after: unknown): Array<{ path: string; before: unknown; after: unknown }> {
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
