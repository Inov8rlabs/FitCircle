/**
 * Home feed editor (Admin Tools "Home feed" module) — the pure side of
 * drafts, publishing and history (docs/HOME_FEED_SPEC.md §9 "Editor").
 *
 *  - A **ruleset** is every `home_feed_rules` row in the flat admin form
 *    `{ key, enabled, priority, ...definition }`.
 *  - Its **version** is a content hash of the canonical ruleset, so a draft
 *    knows exactly which published state it was made against (optimistic
 *    concurrency: publish with a stale `baseVersion` → 409).
 *  - A **changeset** is the list of create / update / enable / disable /
 *    delete operations that turns one ruleset into another.
 *
 * No I/O here; HomeFeedAdminService does the reads/writes.
 */
import { createHash } from 'node:crypto';

import { z } from 'zod';

import { compareRules, parseRuleRow, ruleDefinitionSchema, ruleInputSchema, ruleKeySchema } from '../rules';

/** One rule in the flat admin form. `definition` fields are spread in. */
export type FlatRule = { key: string; enabled: boolean; priority: number } & Record<string, unknown>;

export interface RuleRowLike {
  key: string;
  enabled: boolean;
  priority: number;
  definition: unknown;
}

/** Hard limits for a single publish. */
export const MAX_CHANGES_PER_PUBLISH = 100;
export const MAX_RULES = 200;

// ---------------------------------------------------------------------------
// Canonical form + version
// ---------------------------------------------------------------------------

/** JSON with object keys sorted at every level (arrays keep their order). */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** DB row → flat admin form (the stored definition as-is, even when it no longer validates). */
export function rowToFlat(row: RuleRowLike): FlatRule {
  const def = row.definition && typeof row.definition === 'object' && !Array.isArray(row.definition) ? (row.definition as Record<string, unknown>) : {};
  return { ...def, key: row.key, enabled: row.enabled === true, priority: Number(row.priority) || 0 };
}

/** Flat form → the `definition` jsonb (everything except key / enabled / priority). */
export function flatDefinition(rule: FlatRule): Record<string, unknown> {
  const { key: _k, enabled: _e, priority: _p, ...def } = rule;
  return def;
}

/** Sorted by key, canonical JSON per rule. */
export function canonicalRuleset(rules: readonly FlatRule[]): string {
  return stableStringify([...rules].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));
}

/**
 * Content version of a ruleset: `r1-<first 16 hex of sha256(canonical)>`.
 * Identical rule content → identical version, whatever the row ids or
 * timestamps. Any change made outside the editor (e.g. the legacy
 * POST/PATCH /rules routes) changes it too, so a stale draft can't clobber it.
 */
export function rulesetVersion(rules: readonly FlatRule[]): string {
  return `r1-${createHash('sha256').update(canonicalRuleset(rules)).digest('hex').slice(0, 16)}`;
}

export const sameRule = (a: FlatRule | undefined, b: FlatRule | undefined) => !!a && !!b && stableStringify(a) === stableStringify(b);

// ---------------------------------------------------------------------------
// Changesets
// ---------------------------------------------------------------------------

/** A rule in a changeset: the flat form, checked as an object here and fully by ruleInputSchema later. */
const flatRuleShape = z
  .object({ key: ruleKeySchema, enabled: z.boolean().optional(), priority: z.number().int().min(-10000).max(10000).optional() })
  .passthrough();

export const ruleChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), rule: flatRuleShape }).strict(),
  /** Full replacement of the rule (definition, enabled, priority). `rule.key` must equal `key`. */
  z.object({ op: z.literal('update'), key: ruleKeySchema, rule: flatRuleShape }).strict(),
  z.object({ op: z.literal('enable'), key: ruleKeySchema }).strict(),
  z.object({ op: z.literal('disable'), key: ruleKeySchema }).strict(),
  z.object({ op: z.literal('delete'), key: ruleKeySchema }).strict(),
]);
export type RuleChange = z.infer<typeof ruleChangeSchema>;

export interface ChangeIssue {
  /** Rule key (or `changes[i]` when the change itself is malformed). */
  key: string;
  path: string;
  message: string;
}

/** Validate + normalise one flat rule with the production validator (rules.ts). */
export function validateFlatRule(input: unknown): { rule: FlatRule; issues: null } | { rule: null; issues: Array<{ path: string; message: string }> } {
  const parsed = ruleInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { rule: null, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })) };
  }
  const { key, enabled, priority, definition } = parsed.data;
  return { rule: { ...definition, key, enabled, priority } as FlatRule, issues: null };
}

/** Is a stored rule's definition valid? (Enabling an invalid row is refused.) */
export function isStoredRuleValid(rule: FlatRule): boolean {
  return parseRuleRow({ key: rule.key, enabled: rule.enabled, priority: rule.priority, definition: flatDefinition(rule) }).rule !== null;
}

/**
 * Apply a changeset to a ruleset. Every created/updated rule is validated
 * with the production schema (and normalised: defaults filled in); enabling
 * a rule whose stored definition no longer validates is refused. Pure.
 */
export function applyChanges(current: readonly FlatRule[], changes: readonly RuleChange[]): { rules: FlatRule[]; issues: ChangeIssue[] } {
  const issues: ChangeIssue[] = [];
  const byKey = new Map(current.map((r) => [r.key, { ...r }]));
  const touched = new Set<string>();

  changes.forEach((change, i) => {
    const key = change.op === 'create' ? change.rule.key : change.key;
    if (touched.has(key)) {
      issues.push({ key, path: `changes.${i}`, message: `rule "${key}" appears in more than one change` });
      return;
    }
    touched.add(key);
    const existing = byKey.get(key);
    switch (change.op) {
      case 'create':
      case 'update': {
        if (change.op === 'create' && existing) {
          issues.push({ key, path: `changes.${i}`, message: `a rule with key "${key}" already exists` });
          return;
        }
        if (change.op === 'update' && !existing) {
          issues.push({ key, path: `changes.${i}`, message: `rule "${key}" does not exist` });
          return;
        }
        if (change.op === 'update' && change.rule.key !== key) {
          issues.push({ key, path: `changes.${i}.rule.key`, message: 'renaming a rule is not supported (delete + create instead)' });
          return;
        }
        const v = validateFlatRule(change.rule);
        if (!v.rule) {
          for (const issue of v.issues) issues.push({ key, path: issue.path, message: issue.message });
          return;
        }
        byKey.set(key, v.rule);
        return;
      }
      case 'enable':
      case 'disable': {
        if (!existing) {
          issues.push({ key, path: `changes.${i}`, message: `rule "${key}" does not exist` });
          return;
        }
        const enabled = change.op === 'enable';
        if (enabled && !isStoredRuleValid(existing)) {
          issues.push({ key, path: `changes.${i}`, message: `rule "${key}" no longer validates — fix it (update) before enabling` });
          return;
        }
        byKey.set(key, { ...existing, enabled });
        return;
      }
      case 'delete': {
        if (!existing) {
          issues.push({ key, path: `changes.${i}`, message: `rule "${key}" does not exist` });
          return;
        }
        byKey.delete(key);
        return;
      }
    }
  });
  if (byKey.size > MAX_RULES) issues.push({ key: '(ruleset)', path: 'changes', message: `at most ${MAX_RULES} rules` });
  return { rules: [...byKey.values()], issues };
}

/**
 * The minimal changeset that turns `before` into `after` (matched by key):
 * only enabled differs → enable/disable; anything else differs → update;
 * missing → delete; new → create. Sorted for stable output (deletes, then
 * by key).
 */
export function diffRulesets(before: readonly FlatRule[], after: readonly FlatRule[]): RuleChange[] {
  const b = new Map(before.map((r) => [r.key, r]));
  const a = new Map(after.map((r) => [r.key, r]));
  const out: RuleChange[] = [];
  for (const [key, prev] of b) {
    const next = a.get(key);
    if (!next) {
      out.push({ op: 'delete', key });
      continue;
    }
    if (sameRule(prev, next)) continue;
    if (sameRule({ ...prev, enabled: next.enabled }, next)) out.push({ op: next.enabled ? 'enable' : 'disable', key });
    else out.push({ op: 'update', key, rule: next });
  }
  for (const [key, next] of a) if (!b.has(key)) out.push({ op: 'create', rule: next });
  const rank = (c: RuleChange) => (c.op === 'delete' ? 0 : 1);
  const keyOf = (c: RuleChange) => (c.op === 'create' ? c.rule.key : c.key);
  return out.sort((x, y) => rank(x) - rank(y) || (keyOf(x) < keyOf(y) ? -1 : keyOf(x) > keyOf(y) ? 1 : 0));
}

/** Flat rules → FeedRules for the ranker (invalid ones dropped, like production does). */
export function toFeedRules(rules: readonly FlatRule[]) {
  return rules
    .map((r) => parseRuleRow({ key: r.key, enabled: r.enabled, priority: r.priority, definition: flatDefinition(r) }).rule)
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort(compareRules);
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

const version = z.string().regex(/^r1-[0-9a-f]{16}$/, 'baseVersion must be the ruleset version the draft was made from');
const appVersion = z.string().regex(/^\d+(\.\d+){0,3}$/);

export const publishBodySchema = z
  .object({
    baseVersion: version,
    changes: z.array(ruleChangeSchema).min(1, 'nothing to publish').max(MAX_CHANGES_PER_PUBLISH),
    /** Plain-English description of the change (shown in history / audit). */
    summary: z.string().trim().min(1).max(4000),
    note: z.string().trim().max(1000).optional(),
    /** Per-change plain-English lines from the editor (stored with the diff). */
    descriptions: z.array(z.string().max(1000)).max(MAX_CHANGES_PER_PUBLISH * 4).optional(),
    /** App version the before/after layout snapshot is computed for (default SNAPSHOT_APP_VERSION). */
    snapshotVersion: appVersion.optional(),
  })
  .strict();
export type PublishBody = z.infer<typeof publishBodySchema>;

export const revertBodySchema = z
  .object({
    changeId: z.string().uuid(),
    baseVersion: version,
    summary: z.string().trim().max(4000).optional(),
    note: z.string().trim().max(1000).optional(),
    descriptions: z.array(z.string().max(1000)).max(MAX_CHANGES_PER_PUBLISH * 4).optional(),
    snapshotVersion: appVersion.optional(),
  })
  .strict();
export type RevertBody = z.infer<typeof revertBodySchema>;

const platform = z.enum(['ios', 'android', 'web']);

export const draftPreviewBodySchema = z
  .object({
    /** Preview as this user (QA / test account). */
    userId: z.string().uuid().optional(),
    /** Preview as the FitCircle admin matching X-Admin-Actor (default when neither userId nor persona). */
    actorAsUser: z.literal(true).optional(),
    /** A synthetic, representative user (no DB user needed; promo cards are not evaluated). */
    persona: z.literal('typical').optional(),
    platform,
    version: appVersion,
    build: z.number().int().min(0).max(999_999_999).optional(),
    timezone: z.string().min(1).max(64).optional(),
    /** `cards=` as a client sends it (default: what that platform/version declares). */
    cards: z.string().max(2000).optional(),
    /** promo@1 `actions=` / `promoLayouts=` (default: none → no promos unless given). */
    actions: z.string().max(1000).optional(),
    promoLayouts: z.string().max(200).optional(),
    draft: z
      .object({
        /** The full proposed ruleset (flat form). */
        rules: z.array(z.record(z.unknown())).max(MAX_RULES).optional(),
        /** …or a changeset against the current published ruleset. */
        changes: z.array(ruleChangeSchema).max(MAX_CHANGES_PER_PUBLISH).optional(),
        /** A historical ruleset to compare against: `{ changeId }` → that change's rules_before. */
        revertOf: z.string().uuid().optional(),
      })
      .strict()
      .refine((d) => [d.rules, d.changes, d.revertOf].filter((v) => v !== undefined).length <= 1, { message: 'draft takes one of rules | changes | revertOf' })
      .optional(),
  })
  .strict()
  .refine((b) => [b.userId, b.actorAsUser, b.persona].filter((v) => v !== undefined).length <= 1, { message: 'use one of userId | actorAsUser | persona' });
export type DraftPreviewBody = z.infer<typeof draftPreviewBodySchema>;

/**
 * A full draft ruleset (flat form, as the editor holds it) → validated rules
 * + the changeset against `current`. Each draft rule is validated with the
 * production schema; invalid ones are reported and left out of `rules`.
 */
export function resolveDraftRuleset(current: readonly FlatRule[], draft: ReadonlyArray<Record<string, unknown>>): { rules: FlatRule[]; changes: RuleChange[]; issues: ChangeIssue[] } {
  const issues: ChangeIssue[] = [];
  const seen = new Set<string>();
  const valid: FlatRule[] = [];
  const currentByKey = new Map(current.map((r) => [r.key, r]));
  draft.forEach((raw, i) => {
    const key = typeof raw.key === 'string' ? raw.key : `rules[${i}]`;
    if (seen.has(key)) {
      issues.push({ key, path: `rules.${i}.key`, message: `duplicate key "${key}"` });
      return;
    }
    seen.add(key);
    // A stored rule that no longer validates may stay as-is (unchanged), but not be edited into another invalid shape.
    const prev = currentByKey.get(key);
    if (prev && sameRule(prev, raw as FlatRule)) {
      valid.push(prev);
      return;
    }
    const v = validateFlatRule(raw);
    if (!v.rule) {
      for (const issue of v.issues) issues.push({ key, path: issue.path, message: issue.message });
      if (prev) valid.push(prev); // keep the published version in the preview
      return;
    }
    valid.push(v.rule);
  });
  return { rules: valid, changes: diffRulesets(current, valid), issues };
}

export { ruleDefinitionSchema };
