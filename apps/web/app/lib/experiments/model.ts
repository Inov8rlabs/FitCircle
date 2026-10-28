/**
 * Experiments: schema, validation and pure rules
 * (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.2–§6.5). No I/O.
 */
import { randomBytes } from 'node:crypto';

import { z } from 'zod';

export const EXPERIMENT_STATUSES = ['draft', 'running', 'paused', 'concluded'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

/**
 * bucket = randomised (analysed) · override = QA · fallback = not running / outside traffic ·
 * winner = concluded · layer = outside the experiment's layer slice ·
 * layer_conflict = already randomised into another running/paused experiment of the same layer.
 */
export const ASSIGNMENT_REASONS = ['bucket', 'override', 'fallback', 'winner', 'layer', 'layer_conflict'] as const;
export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];

export type ClientPlatform = 'ios' | 'android' | 'web';

/** Layer buckets: experimentBucket(userId, layer.salt) ∈ [0, 10 000). */
export const LAYER_BUCKETS = 10_000;
/** Statuses whose layer slice is reserved (concluded experiments release theirs). */
export const SLICE_HOLDING_STATUSES: readonly ExperimentStatus[] = ['draft', 'running', 'paused'];
/** Statuses whose randomised users block enrolment in a sibling experiment of the same layer. */
export const CONFLICT_STATUSES: readonly ExperimentStatus[] = ['running', 'paused'];

const keySlug = z.string().regex(/^[a-z0-9][a-z0-9_]{0,63}$/, 'use lowercase letters, digits and _ (≤ 64)');
/**
 * Arm keys are generic so analytics values read the same in every experiment
 * (exp_<key> = control | variantA | variantB …): exactly one `control`, then
 * variantA, variantB, … with no gaps (≤ variantI, 10 arms). The human label
 * lives in `name`; clients act on `payload`, never on the key.
 */
export const CONTROL_ARM = 'control';
export const VARIANT_LETTERS = 'ABCDEFGHI';
export const ARM_KEY_PATTERN = /^(control|variant[A-I])$/;
const armKey = z.string().regex(ARM_KEY_PATTERN, 'arm keys are "control" or variantA … variantI');
const versionString = z.string().regex(/^\d+(\.\d+){0,3}$/, 'version must look like 1.2.0');
const countryCode = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'ISO 3166-1 alpha-2 country code')
  .transform((c) => c.toUpperCase());

export const armSchema = z
  .object({
    key: armKey,
    /** Human label shown in Admin Tools and sent as exp_<key>_name (e.g. "Tour + hard paywall"). */
    name: z.string().trim().min(1).max(60),
    description: z.string().max(500).nullish(),
    /** Integer percent of enrolled users; all arms sum to 100. */
    weight: z.number().int().min(0).max(100),
    /** Opaque JSON handed to clients with the arm (e.g. {flow:'v2', paywall:'hard'}). */
    payload: z.record(z.unknown()).default({}),
  })
  .strict();
export type ExperimentArm = z.infer<typeof armSchema>;

export const armsSchema = z
  .array(armSchema)
  .min(1)
  .max(10)
  .superRefine((arms, ctx) => {
    const total = arms.reduce((s, a) => s + a.weight, 0);
    if (total !== 100) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `arm weights must sum to 100 (got ${total})` });
    if (new Set(arms.map((a) => a.key)).size !== arms.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'arm keys must be unique' });
    if (arms.filter((a) => a.key === CONTROL_ARM).length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'exactly one arm must be "control"' });
    const letters = arms
      .filter((a) => a.key.startsWith('variant'))
      .map((a) => a.key.slice('variant'.length))
      .sort()
      .join('');
    if (letters !== VARIANT_LETTERS.slice(0, letters.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'variants must be consecutive from variantA (variantA, variantB, …) with no gaps' });
    }
  });

export const audienceSchema = z
  .object({
    platforms: z.array(z.enum(['ios', 'android', 'web'])).min(1).optional(),
    minAppVersion: versionString.optional(),
    maxAppVersion: versionString.optional(),
    /** Profile created < 24 h ago and onboarding not completed. */
    newUsersOnly: z.boolean().optional(),
    countries: z.array(countryCode).min(1).max(250).optional(),
    excludeUserIds: z.array(z.string().uuid()).max(1000).optional(),
  })
  .strict();
export type ExperimentAudience = z.infer<typeof audienceSchema>;

/** A mutual-exclusion slice: the experiment only sees users whose layer bucket ∈ [start, end). */
export const layerRefSchema = z
  .object({
    key: keySlug,
    start: z.number().int().min(0).max(LAYER_BUCKETS - 1),
    end: z.number().int().min(1).max(LAYER_BUCKETS),
  })
  .strict()
  .refine((l) => l.start < l.end, { message: 'layer.start must be < layer.end', path: ['end'] });
export type LayerRef = z.infer<typeof layerRefSchema>;
/** A persisted experiment, as the service and admin API see it. */
export interface Experiment {
  key: string;
  name: string;
  description: string | null;
  status: ExperimentStatus;
  salt: string;
  arms: ExperimentArm[];
  trafficPct: number;
  audience: ExperimentAudience;
  fallbackArm: string;
  winnerArm: string | null;
  /** Mutual-exclusion layer slice, or null (non-layered: sees every eligible user). */
  layer: LayerRef | null;
  startedAt: string | null;
  endedAt: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** DB row → Experiment. Malformed arms/audience surface as validation errors. */
export function experimentFromRow(row: Record<string, any>): Experiment {
  return {
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    salt: row.salt,
    arms: armsSchema.parse(row.arms ?? []),
    trafficPct: Number(row.traffic_pct ?? 100),
    audience: audienceSchema.parse(row.audience ?? {}),
    fallbackArm: row.fallback_arm,
    winnerArm: row.winner_arm ?? null,
    layer:
      row.layer_key != null && row.layer_start != null && row.layer_end != null
        ? { key: row.layer_key, start: Number(row.layer_start), end: Number(row.layer_end) }
        : null,
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function experimentToRow(e: Omit<Experiment, 'createdAt' | 'updatedAt'>): Record<string, unknown> {
  return {
    key: e.key,
    name: e.name,
    description: e.description,
    status: e.status,
    salt: e.salt,
    arms: e.arms,
    traffic_pct: e.trafficPct,
    audience: e.audience,
    fallback_arm: e.fallbackArm,
    winner_arm: e.winnerArm,
    layer_key: e.layer?.key ?? null,
    layer_start: e.layer?.start ?? null,
    layer_end: e.layer?.end ?? null,
    started_at: e.startedAt,
    ended_at: e.endedAt,
    created_by: e.createdBy,
  };
}

/** 128 random bits, hex. A salt is never reused or edited. */
export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// Admin inputs
// ---------------------------------------------------------------------------

const armRefIssue = (arms: { key: string }[], ref: string | null | undefined, field: string, ctx: z.RefinementCtx) => {
  if (ref != null && !arms.some((a) => a.key === ref)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} "${ref}" is not one of the arms` });
  }
};

export const createExperimentSchema = z
  .object({
    key: keySlug,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).nullish(),
    arms: armsSchema,
    trafficPct: z.number().int().min(0).max(100).default(100),
    audience: audienceSchema.default({}),
    fallbackArm: armKey.default(CONTROL_ARM),
    layer: layerRefSchema.nullish(),
  })
  .strict()
  .superRefine((v, ctx) => armRefIssue(v.arms, v.fallbackArm, 'fallbackArm', ctx));
export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;

export const patchExperimentSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    status: z.enum(EXPERIMENT_STATUSES).optional(),
    arms: armsSchema.optional(),
    trafficPct: z.number().int().min(0).max(100).optional(),
    audience: audienceSchema.optional(),
    fallbackArm: armKey.optional(),
    /** Required when moving to `concluded`. */
    winnerArm: armKey.nullable().optional(),
    /** Move into / between layers or change the slice; null leaves the layer. */
    layer: layerRefSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');
export type PatchExperimentInput = z.infer<typeof patchExperimentSchema>;

export const overrideInputSchema = z
  .object({
    email: z.string().trim().email().max(254).optional(),
    userId: z.string().uuid().optional(),
    arm: armKey,
    note: z.string().max(500).nullish(),
  })
  .strict()
  .refine((v) => !!v.email !== !!v.userId, 'give exactly one of email or userId');
export type OverrideInput = z.infer<typeof overrideInputSchema>;

export const overrideRemoveSchema = z
  .object({ email: z.string().trim().email().max(254).optional(), userId: z.string().uuid().optional() })
  .strict()
  .refine((v) => !!v.email !== !!v.userId, 'give exactly one of email or userId');

/** Legal status moves. `concluded` is terminal. */
const TRANSITIONS: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  draft: ['running'],
  running: ['paused', 'concluded'],
  paused: ['running', 'concluded'],
  concluded: [],
};

export function canTransition(from: ExperimentStatus, to: ExperimentStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export class ExperimentValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ExperimentValidationError';
  }
}

/**
 * Apply an admin patch to an experiment (pure). Throws ExperimentValidationError
 * for illegal transitions or references. `hasAssignments` blocks removing arms
 * that users are already in (their rows would point at nothing).
 */
export function applyPatch(current: Experiment, patch: PatchExperimentInput, opts: { now: Date; hasAssignments: boolean }): Experiment {
  const next: Experiment = { ...current };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.arms !== undefined) {
    const removed = current.arms.filter((a) => !patch.arms!.some((b) => b.key === a.key)).map((a) => a.key);
    if (removed.length && (opts.hasAssignments || current.status !== 'draft')) {
      throw new ExperimentValidationError('ARM_IN_USE', `arms cannot be removed once the experiment has started or has assignments: ${removed.join(', ')}`);
    }
    next.arms = patch.arms;
  }
  if (patch.trafficPct !== undefined) next.trafficPct = patch.trafficPct;
  if (patch.audience !== undefined) next.audience = patch.audience;
  if (patch.fallbackArm !== undefined) next.fallbackArm = patch.fallbackArm;
  if (patch.winnerArm !== undefined) next.winnerArm = patch.winnerArm;
  if (patch.layer !== undefined) next.layer = patch.layer;

  if (patch.status !== undefined && patch.status !== current.status) {
    if (!canTransition(current.status, patch.status)) {
      throw new ExperimentValidationError('INVALID_TRANSITION', `cannot move from ${current.status} to ${patch.status}`);
    }
    next.status = patch.status;
    const at = opts.now.toISOString();
    if (patch.status === 'running' && !current.startedAt) next.startedAt = at;
    if (patch.status === 'concluded') next.endedAt = at;
  }
  if (current.status === 'concluded' && patch.winnerArm !== undefined && patch.winnerArm !== current.winnerArm) {
    throw new ExperimentValidationError('CONCLUDED', 'the winner of a concluded experiment cannot change');
  }

  if (!next.arms.some((a) => a.key === next.fallbackArm)) {
    throw new ExperimentValidationError('INVALID_ARM', `fallbackArm "${next.fallbackArm}" is not one of the arms`);
  }
  if (next.winnerArm != null && !next.arms.some((a) => a.key === next.winnerArm)) {
    throw new ExperimentValidationError('INVALID_ARM', `winnerArm "${next.winnerArm}" is not one of the arms`);
  }
  if (next.status === 'concluded' && !next.winnerArm) {
    throw new ExperimentValidationError('WINNER_REQUIRED', 'pick a winnerArm to conclude');
  }
  return next;
}

/** The public view (admin API): everything but the salt. */
export function publicExperiment(e: Experiment): Omit<Experiment, 'salt'> {
  const { salt: _salt, ...rest } = e;
  return rest;
}

// ---------------------------------------------------------------------------
// Layers (mutual exclusion)
// ---------------------------------------------------------------------------

export interface ExperimentLayer {
  key: string;
  name: string;
  description: string | null;
  salt: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export function layerFromRow(row: Record<string, any>): ExperimentLayer {
  return {
    key: row.key,
    name: row.name,
    description: row.description ?? null,
    salt: row.salt,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function publicLayer(l: ExperimentLayer): Omit<ExperimentLayer, 'salt'> {
  const { salt: _salt, ...rest } = l;
  return rest;
}

export const createLayerSchema = z
  .object({ key: keySlug, name: z.string().trim().min(1).max(120), description: z.string().max(2000).nullish() })
  .strict();
export type CreateLayerInput = z.infer<typeof createLayerSchema>;

export const patchLayerSchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(2000).nullable().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');
export type PatchLayerInput = z.infer<typeof patchLayerSchema>;

export interface Slice {
  start: number;
  end: number;
}

export const slicesOverlap = (a: Slice, b: Slice): boolean => a.start < b.end && b.start < a.end;

/**
 * Experiments of the same layer whose reserved slice overlaps `candidate`
 * (draft / running / paused hold their slice; concluded ones released it).
 */
export function overlappingExperiments(
  candidate: { key: string; layer: LayerRef },
  others: ReadonlyArray<Pick<Experiment, 'key' | 'status' | 'layer'>>
): Array<{ key: string; status: ExperimentStatus; start: number; end: number }> {
  return others
    .filter((o) => o.key !== candidate.key && o.layer?.key === candidate.layer.key && SLICE_HOLDING_STATUSES.includes(o.status))
    .filter((o) => slicesOverlap(o.layer!, candidate.layer))
    .map((o) => ({ key: o.key, status: o.status, start: o.layer!.start, end: o.layer!.end }));
}

/** Unreserved [start, end) ranges of a layer, ascending. */
export function freeRanges(reserved: readonly Slice[]): Slice[] {
  const sorted = [...reserved].sort((a, b) => a.start - b.start);
  const out: Slice[] = [];
  let cursor = 0;
  for (const r of sorted) {
    if (r.start > cursor) out.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < LAYER_BUCKETS) out.push({ start: cursor, end: LAYER_BUCKETS });
  return out;
}

/** True when the experiment's layer or slice differs. */
export function layerChanged(a: LayerRef | null, b: LayerRef | null): boolean {
  return (a?.key ?? null) !== (b?.key ?? null) || (a?.start ?? null) !== (b?.start ?? null) || (a?.end ?? null) !== (b?.end ?? null);
}
