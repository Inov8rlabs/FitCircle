/**
 * Feed rules (spec §5 rules.ts): JSON rule schema (zod), deterministic
 * bucketing, and rule selection for a FeedContext. Pure.
 *
 * A rule is stored as a `home_feed_rules` row: `key`, `enabled`, `priority`
 * columns + `definition` jsonb (everything else below). Admin APIs accept the
 * flat form `{ key, enabled, priority, ...definition }`.
 *
 * Ordering semantics:
 *  - Rules apply in ascending `priority` (then `key`), so a HIGHER priority
 *    applies LATER and wins conflicting moves/variants.
 *  - At most one experiment per response (schema 1 reports one): when several
 *    enrolled experiment rules match, only the highest-priority one applies.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { CARD_REF_PATTERN } from './catalog';
import type { AppPlatform, FeedContext, FeedExperiment } from './types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const cardRef = z.string().regex(CARD_REF_PATTERN, 'card must be a lowercase snake_case card type or promo:<key>');
const versionString = z.string().regex(/^\d+(\.\d+){0,3}$/, 'version must look like 1.0.8');
const slug = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/i, 'use letters, digits, _ . - (≤ 64)');

const moveAction = z
  .object({
    op: z.literal('move'),
    card: cardRef,
    before: cardRef.optional(),
    after: cardRef.optional(),
    toTop: z.literal(true).optional(),
    toBottom: z.literal(true).optional(),
  })
  .strict();
const hideAction = z.object({ op: z.literal('hide'), card: cardRef }).strict();
/** `show`: restores a card a hint or an earlier rule hid. `version` lets a rule introduce a type the catalog doesn't know yet. */
const showAction = z
  .object({ op: z.literal('show'), card: cardRef, version: z.number().int().min(1).max(999).optional() })
  .strict();
const variantAction = z
  .object({ op: z.literal('variant'), card: cardRef, variant: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/i) })
  .strict();
/** `boost`: score points (10 = one slot of the default order; negative sinks). */
const boostAction = z.object({ op: z.literal('boost'), card: cardRef, by: z.number().min(-1000).max(1000) }).strict();

export const ruleActionSchema = z
  .discriminatedUnion('op', [moveAction, hideAction, showAction, variantAction, boostAction])
  .superRefine((a, ctx) => {
    if (a.op !== 'move') return;
    const targets = [a.before, a.after, a.toTop, a.toBottom].filter((v) => v !== undefined).length;
    if (targets !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'move needs exactly one of before | after | toTop | toBottom' });
    if (a.before === a.card || a.after === a.card) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'move target must be another card' });
  });
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const audienceSchema = z
  .object({
    /** Rollout: users with bucket(user, salt) < percent. Salt defaults to the rule key. */
    percent: z.number().int().min(0).max(100).optional(),
    bucketSalt: z.string().min(1).max(64).optional(),
    pro: z.boolean().optional(),
    hasCircle: z.boolean().optional(),
    campaignPresent: z.boolean().optional(),
    campaignPhase: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    referralProgramEnabled: z.boolean().optional(),
    checkedInToday: z.boolean().optional(),
    streakAtRisk: z.boolean().optional(),
    waterLoggedToday: z.boolean().optional(),
    daysSinceSignupLt: z.number().int().min(0).optional(),
    daysSinceSignupGte: z.number().int().min(0).optional(),
    localHourGte: z.number().int().min(0).max(23).optional(),
    localHourLt: z.number().int().min(1).max(24).optional(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
    userIds: z.array(z.string().uuid()).max(500).optional(),
  })
  .strict();
export type RuleAudience = z.infer<typeof audienceSchema>;

const experimentArmSchema = z
  .object({
    name: slug,
    /** Share of the (audience-matching) users in this arm; arms fill buckets in order. */
    percent: z.number().int().min(0).max(100),
    actions: z.array(ruleActionSchema).max(50).default([]),
    layoutKey: slug.optional(),
  })
  .strict();

const experimentSchema = z
  .object({
    key: slug,
    /** Bucketing salt (default: experiment key). Changing it reshuffles users. */
    salt: z.string().min(1).max(64).optional(),
    arms: z.array(experimentArmSchema).min(1).max(10),
  })
  .strict()
  .superRefine((e, ctx) => {
    const total = e.arms.reduce((s, a) => s + a.percent, 0);
    if (total > 100) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `arm percents sum to ${total} (> 100)` });
    if (new Set(e.arms.map((a) => a.name)).size !== e.arms.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'arm names must be unique' });
  });

/** The `definition` jsonb (everything except key/enabled/priority). */
export const ruleDefinitionSchema = z
  .object({
    description: z.string().max(500).optional(),
    platforms: z.array(z.enum(['ios', 'android', 'web'])).min(1).optional(),
    minAppVersion: versionString.optional(),
    maxAppVersion: versionString.optional(),
    audience: audienceSchema.optional(),
    /** Appended to layout_key when this rule applies (default: the rule key). */
    layoutKey: slug.optional(),
    actions: z.array(ruleActionSchema).max(50).default([]),
    experiment: experimentSchema.optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.actions.length === 0 && !d.experiment) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a rule needs actions or an experiment' });
    if (d.actions.length > 0 && d.experiment) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'put actions inside experiment arms, not both' });
  });
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;

export const ruleKeySchema = slug;

/** Flat admin form: `{ key, enabled, priority, ...definition }`. */
export const ruleInputSchema = z
  .object({
    key: ruleKeySchema,
    enabled: z.boolean().default(false),
    priority: z.number().int().min(-10000).max(10000).default(0),
  })
  .passthrough()
  .transform((v, ctx) => {
    const { key, enabled, priority, ...rest } = v as Record<string, unknown> & { key: string; enabled: boolean; priority: number };
    const parsed = ruleDefinitionSchema.safeParse(rest);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
      return z.NEVER;
    }
    return { key, enabled, priority, definition: parsed.data };
  });
export type RuleInput = z.output<typeof ruleInputSchema>;

export interface FeedRule extends RuleDefinition {
  key: string;
  enabled: boolean;
  priority: number;
}

/** A DB row → FeedRule, or the validation issues (the row is then skipped). */
export function parseRuleRow(row: {
  key: string;
  enabled: boolean;
  priority: number;
  definition: unknown;
}): { rule: FeedRule; issues: null } | { rule: null; issues: string[] } {
  const parsed = ruleDefinitionSchema.safeParse(row.definition ?? {});
  if (!parsed.success) {
    return { rule: null, issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  return { rule: { ...parsed.data, key: row.key, enabled: row.enabled === true, priority: Number(row.priority) || 0 }, issues: null };
}

// ---------------------------------------------------------------------------
// Bucketing + matching
// ---------------------------------------------------------------------------

/** Deterministic 0–99 bucket: sha256(`${salt}:${userId}`) first 4 bytes mod 100. */
export function bucketOf(userId: string, salt: string): number {
  const digest = createHash('sha256').update(`${salt}:${userId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/** "1.0.8" → [1,0,8]; tolerates suffixes ("1.0.8 (61)", "1.0.8-dev"); null when unparseable. */
export function parseVersion(v: string | null | undefined): number[] | null {
  const m = /^\s*v?(\d+(?:\.\d+){0,3})/.exec(v ?? '');
  return m ? m[1].split('.').map(Number) : null;
}

export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Platform + app version gates. Unknown platform/version never matches a gated rule. */
export function matchesClient(rule: Pick<FeedRule, 'platforms' | 'minAppVersion' | 'maxAppVersion'>, platform: AppPlatform | null, appVersion: string | null): boolean {
  if (rule.platforms && (!platform || !rule.platforms.includes(platform))) return false;
  if (rule.minAppVersion || rule.maxAppVersion) {
    const v = parseVersion(appVersion);
    if (!v) return false;
    if (rule.minAppVersion && compareVersions(v, parseVersion(rule.minAppVersion)!) < 0) return false;
    if (rule.maxAppVersion && compareVersions(v, parseVersion(rule.maxAppVersion)!) > 0) return false;
  }
  return true;
}

/** `want` is set → ctx value must be known and equal. */
const boolMatch = (want: boolean | undefined, have: boolean | null): boolean => want === undefined || (have !== null && have === want);

/** Audience filters except `percent` (see matchesRollout). Unknown context values never match. */
export function matchesAudience(a: RuleAudience | undefined, ctx: FeedContext): boolean {
  if (!a) return true;
  if (!boolMatch(a.pro, ctx.isPro)) return false;
  if (!boolMatch(a.hasCircle, ctx.hasCircle)) return false;
  if (!boolMatch(a.campaignPresent, ctx.campaign ? ctx.campaign.present : null)) return false;
  if (a.campaignPhase !== undefined) {
    const phases = Array.isArray(a.campaignPhase) ? a.campaignPhase : [a.campaignPhase];
    if (!ctx.campaign?.present || !ctx.campaign.phase || !phases.includes(ctx.campaign.phase)) return false;
  }
  if (!boolMatch(a.referralProgramEnabled, ctx.referralProgramEnabled)) return false;
  if (!boolMatch(a.checkedInToday, ctx.checkedInToday)) return false;
  if (a.streakAtRisk !== undefined && ctx.streakAtRisk !== a.streakAtRisk) return false;
  if (!boolMatch(a.waterLoggedToday, ctx.waterLoggedToday)) return false;
  if (a.daysSinceSignupLt !== undefined && (ctx.daysSinceSignup === null || !(ctx.daysSinceSignup < a.daysSinceSignupLt))) return false;
  if (a.daysSinceSignupGte !== undefined && (ctx.daysSinceSignup === null || !(ctx.daysSinceSignup >= a.daysSinceSignupGte))) return false;
  if (a.localHourGte !== undefined && ctx.localHour < a.localHourGte) return false;
  if (a.localHourLt !== undefined && ctx.localHour >= a.localHourLt) return false;
  if (a.weekdays && !a.weekdays.includes(ctx.localWeekday)) return false;
  if (a.userIds && !a.userIds.includes(ctx.userId)) return false;
  return true;
}

export function matchesRollout(rule: Pick<FeedRule, 'key' | 'audience'>, userId: string): boolean {
  const percent = rule.audience?.percent;
  if (percent === undefined) return true;
  return bucketOf(userId, rule.audience?.bucketSalt ?? rule.key) < percent;
}

/** Arm for this user, or null when their bucket falls outside every arm. */
export function assignArm(experiment: NonNullable<FeedRule['experiment']>, userId: string) {
  const bucket = bucketOf(userId, experiment.salt ?? experiment.key);
  let upper = 0;
  for (const arm of experiment.arms) {
    upper += arm.percent;
    if (bucket < upper) return arm;
  }
  return null;
}

export interface AppliedRule {
  key: string;
  priority: number;
  actions: RuleAction[];
  /** Segment appended to layout_key. */
  layoutSegment: string;
  experiment: FeedExperiment | null;
}

export const compareRules = (a: Pick<FeedRule, 'priority' | 'key'>, b: Pick<FeedRule, 'priority' | 'key'>) =>
  a.priority - b.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * Rules that apply to this context, in application order (ascending priority).
 * `includeDisabled` is for the admin preview only.
 */
export function selectRules(rules: readonly FeedRule[], ctx: FeedContext, opts: { includeDisabled?: boolean } = {}): AppliedRule[] {
  const matching = rules
    .filter((r) => (opts.includeDisabled || r.enabled) && matchesClient(r, ctx.platform, ctx.appVersion))
    .filter((r) => matchesAudience(r.audience, ctx) && matchesRollout(r, ctx.userId))
    .sort(compareRules);

  // One experiment per response: the highest-priority one the user is enrolled in.
  let winner: { key: string; arm: string } | null = null;
  for (let i = matching.length - 1; i >= 0 && !winner; i--) {
    const r = matching[i];
    if (!r.experiment) continue;
    const arm = assignArm(r.experiment, ctx.userId);
    if (arm) winner = { key: r.key, arm: arm.name };
  }

  const applied: AppliedRule[] = [];
  for (const r of matching) {
    if (!r.experiment) {
      applied.push({ key: r.key, priority: r.priority, actions: r.actions, layoutSegment: r.layoutKey ?? r.key, experiment: null });
      continue;
    }
    if (winner?.key !== r.key) continue;
    const arm = r.experiment.arms.find((a) => a.name === winner.arm)!;
    applied.push({
      key: r.key,
      priority: r.priority,
      actions: arm.actions,
      layoutSegment: arm.layoutKey ?? `${r.experiment.key}.${arm.name}`,
      experiment: { key: r.experiment.key, arm: arm.name },
    });
  }
  return applied;
}
