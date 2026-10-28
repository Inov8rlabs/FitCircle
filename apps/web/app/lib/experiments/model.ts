/**
 * Experiments: schema, validation and pure rules
 * (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6.2–§6.5). No I/O.
 */
import { randomBytes } from 'node:crypto';

import { z } from 'zod';

export const EXPERIMENT_STATUSES = ['draft', 'running', 'paused', 'concluded'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const ASSIGNMENT_REASONS = ['bucket', 'override', 'fallback', 'winner'] as const;
export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];

export type ClientPlatform = 'ios' | 'android' | 'web';

const keySlug = z.string().regex(/^[a-z0-9][a-z0-9_]{0,63}$/, 'use lowercase letters, digits and _ (≤ 64)');
const armKey = z.string().regex(/^[a-z0-9][a-z0-9_]{0,39}$/, 'arm keys: lowercase letters, digits and _ (≤ 40)');
const versionString = z.string().regex(/^\d+(\.\d+){0,3}$/, 'version must look like 1.2.0');
const countryCode = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'ISO 3166-1 alpha-2 country code')
  .transform((c) => c.toUpperCase());

export const armSchema = z
  .object({
    key: armKey,
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
    fallbackArm: armKey,
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
