/**
 * Remote config resolution (docs/TRIAL_FIRST_SPEC.md §6.4) — pure.
 *
 *   1. enabled rules for the key whose audience matches, highest priority first
 *      (ties → oldest created_at, then id); the first with a VALID value wins,
 *   2. else the admin default row, if valid,
 *   3. else the code default.
 *
 * Values are re-validated here (on read) against the registry bounds, so a bad row
 * written outside the API, or a bound tightened in code, falls through to the next source.
 */
import { z } from 'zod';

import { audienceMismatch, audienceSchema, type AudienceFacts, type RcAudience } from './audience';
import { codeDefault, validValue, type RemoteConfigKey, type RemoteConfigValue } from './registry';

export interface RuleRow {
  id: string;
  config_key: string;
  name: string;
  enabled: boolean;
  priority: number;
  audience: unknown;
  value: unknown;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface DefaultRow {
  config_key: string;
  value: unknown;
  updated_by: string | null;
  updated_at: string;
}

/** A rule whose audience parsed (invalid-audience rules are skipped at load). */
export interface ParsedRule extends RuleRow {
  parsedAudience: RcAudience;
}

export interface ConfigSnapshot {
  rules: ParsedRule[];
  defaults: Map<string, DefaultRow>;
}

export const EMPTY_SNAPSHOT: ConfigSnapshot = { rules: [], defaults: new Map() };

export type ResolutionSource = 'rule' | 'default' | 'code';

export interface Resolution {
  value: RemoteConfigValue;
  source: ResolutionSource;
  ruleId?: string;
  ruleName?: string;
}

export function parseRules(rows: readonly RuleRow[]): ParsedRule[] {
  const out: ParsedRule[] = [];
  for (const row of rows) {
    const parsed = audienceSchema.safeParse(row.audience ?? {});
    if (!parsed.success) {
      console.warn(`[remote-config] rule ${row.id} (${row.config_key}) has an invalid audience; skipped`);
      continue;
    }
    out.push({ ...row, parsedAudience: parsed.data });
  }
  return out;
}

/** Highest priority first; ties → oldest; then id for a total order. */
export function compareRules(a: Pick<RuleRow, 'priority' | 'created_at' | 'id'>, b: Pick<RuleRow, 'priority' | 'created_at' | 'id'>): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const at = Date.parse(a.created_at);
  const bt = Date.parse(b.created_at);
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Enabled candidate rules for a key, in evaluation order. */
export function candidateRules(snapshot: ConfigSnapshot, key: RemoteConfigKey): ParsedRule[] {
  return snapshot.rules.filter((r) => r.config_key === key && r.enabled).sort(compareRules);
}

/** Non-rule fallback: the admin default when valid, else the code default. */
export function fallbackResolution(snapshot: ConfigSnapshot, key: RemoteConfigKey): Resolution {
  const row = snapshot.defaults.get(key);
  const v = row ? validValue(key, row.value) : null;
  if (v !== null) return { value: v, source: 'default' };
  return { value: codeDefault(key), source: 'code' };
}

/** Synchronous resolution when every fact a candidate needs is already in `facts`. */
export function resolveWithFacts(snapshot: ConfigSnapshot, key: RemoteConfigKey, facts: AudienceFacts): Resolution {
  for (const rule of candidateRules(snapshot, key)) {
    if (audienceMismatch(rule.parsedAudience, facts, rule.id)) continue;
    const v = validValue(key, rule.value);
    if (v === null) continue; // invalid on read → next source
    return { value: v, source: 'rule', ruleId: rule.id, ruleName: rule.name };
  }
  return fallbackResolution(snapshot, key);
}

// ---------------------------------------------------------------------------- admin input schemas

export const ruleCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean().default(false),
    priority: z.number().int().min(-1_000_000).max(1_000_000).default(0),
    audience: audienceSchema.default({}),
    value: z.unknown(),
  })
  .strict();

export const rulePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    audience: audienceSchema.optional(),
    value: z.unknown().optional(),
  })
  .strict();

export const defaultPutSchema = z.object({ value: z.unknown() }).strict();

export type RuleCreateInput = z.output<typeof ruleCreateSchema>;
export type RulePatchInput = z.output<typeof rulePatchSchema>;
