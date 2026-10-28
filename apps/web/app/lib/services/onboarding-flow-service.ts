/**
 * Onboarding v1/v2 server state (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md R2, R3,
 * §5.3, §5.5): resumable progress, the v2 plan targets and the tour_hard gate.
 *
 *  PATCH /api/mobile/onboarding/progress → saveProgress
 *  GET   /api/mobile/onboarding/status   → getResume (merged into the legacy status)
 *  POST  /api/mobile/onboarding/plan     → plan
 *  POST  /api/mobile/onboarding/gate     → reachPaywall
 */
import { z } from 'zod';

import { ExperimentService } from '../experiments/service';
import { ageFrom, computePlan, type PlanRequest, type PlanTargets } from '../onboarding/plan';
import { createAdminSupabase } from '../supabase-admin';

export const ONBOARDING_EXPERIMENT_KEY = 'onboarding_v2';
/** The only arm whose paywall locks the app (§5.5). */
export const HARD_GATE_ARM = 'tour_hard';
/** Accounts at least this old are never pushed back into onboarding (R2). */
export const RESUME_MAX_ACCOUNT_AGE_MS = 30 * 86_400_000;
/** Saved answers are small; refuse anything that looks like abuse. */
export const PROGRESS_DATA_MAX_BYTES = 16_384;

export type OnboardingGate = 'none' | 'subscription_required';

export const progressSchema = z
  .object({
    flow: z.enum(['v1', 'v2']),
    step: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/, 'step ids are letters, digits, _ . : -'),
    data: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine((v) => v.data === undefined || JSON.stringify(v.data).length <= PROGRESS_DATA_MAX_BYTES, {
    message: `data must be ≤ ${PROGRESS_DATA_MAX_BYTES} bytes of JSON`,
    path: ['data'],
  });
export type ProgressInput = z.infer<typeof progressSchema>;

export const gateSchema = z.object({ reached: z.literal(true) }).strip();

export interface ResumeState {
  flow: 'v1' | 'v2';
  step: string;
  data: Record<string, unknown>;
  updatedAt: string | null;
}

export interface ResumeInfo {
  shouldResume: boolean;
  resume: ResumeState | null;
}

/**
 * Pure: resume only when ALL hold — onboarding not completed, account younger
 * than 30 days, and a resume point written by PATCH /onboarding/progress
 * (flow + step non-null). Legacy accounts stuck at "not completed" (the old
 * Android back-button bug) have no such row and must never be thrown back
 * into onboarding.
 */
export function shouldResumeOnboarding(
  profile: { created_at?: string | null; onboarding_completed?: boolean | null },
  hasResumePoint: boolean,
  now: Date
): boolean {
  if (!hasResumePoint) return false;
  if (profile.onboarding_completed === true) return false;
  const created = profile.created_at ? Date.parse(profile.created_at) : NaN;
  if (Number.isNaN(created)) return false;
  return now.getTime() - created < RESUME_MAX_ACCOUNT_AGE_MS;
}

export class OnboardingFlowService {
  /** Upsert the resume point (debounced by clients on every step change). */
  static async saveProgress(userId: string, input: ProgressInput, now: Date = new Date()): Promise<ResumeState> {
    const supabase = createAdminSupabase();
    const at = now.toISOString();
    const row: Record<string, unknown> = { user_id: userId, flow: input.flow, step: input.step, updated_at: at };
    if (input.data !== undefined) row.data = input.data;
    const { data, error } = await supabase
      .from('onboarding_progress')
      .upsert(row, { onConflict: 'user_id' })
      .select('flow, step, data, updated_at')
      .single();
    if (error) throw new Error(`onboarding_progress upsert failed: ${error.message}`);
    const { error: profileError } = await supabase.from('profiles').update({ onboarding_flow: input.flow }).eq('id', userId);
    if (profileError) console.warn('[OnboardingFlowService.saveProgress] profiles.onboarding_flow:', profileError.message);
    return {
      flow: (data?.flow ?? input.flow) as ResumeState['flow'],
      step: (data?.step ?? input.step) as string,
      data: (data?.data as Record<string, unknown> | null) ?? input.data ?? {},
      updatedAt: (data?.updated_at as string | null) ?? at,
    };
  }

  /**
   * The additive status fields. Fail-soft: before migration 112 (or on any read
   * error) it answers `{ shouldResume: false, resume: null }` so the legacy
   * status keeps working.
   */
  static async getResume(userId: string, now: Date = new Date()): Promise<ResumeInfo> {
    try {
      const supabase = createAdminSupabase();
      const [{ data: profile, error: pErr }, { data: progress, error: gErr }] = await Promise.all([
        supabase.from('profiles').select('created_at, onboarding_completed').eq('id', userId).maybeSingle(),
        supabase.from('onboarding_progress').select('flow, step, data, updated_at, is_complete').eq('user_id', userId).maybeSingle(),
      ]);
      if (pErr || !profile) return { shouldResume: false, resume: null };
      if (gErr || !progress || progress.is_complete === true || !progress.step || (progress.flow !== 'v1' && progress.flow !== 'v2')) {
        return { shouldResume: false, resume: null };
      }
      const shouldResume = shouldResumeOnboarding(profile as any, true, now);
      if (!shouldResume) return { shouldResume: false, resume: null };
      return {
        shouldResume,
        resume: {
          flow: progress.flow,
          step: progress.step,
          data: progress.data && typeof progress.data === 'object' && !Array.isArray(progress.data) ? (progress.data as Record<string, unknown>) : {},
          updatedAt: progress.updated_at ?? null,
        },
      };
    } catch (err: any) {
      console.warn('[OnboardingFlowService.getResume] failed:', err?.message);
      return { shouldResume: false, resume: null };
    }
  }

  /** Plan targets; body values win, the profile (saved by R3) fills gaps. */
  static plan(profile: Record<string, any>, input: PlanRequest, now: Date = new Date()): PlanTargets {
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
    const ok = (v: number | null, min: number, max: number) => (v !== null && Number.isFinite(v) && v >= min && v <= max ? v : null);
    return computePlan({
      ...input,
      heightCm: input.heightCm ?? ok(num(profile.height_cm), 100, 250),
      weightKg: input.weightKg ?? ok(num(profile.weight_kg), 30, 300),
      age: input.age ?? ageFrom(profile.date_of_birth, now),
    });
  }

  /**
   * POST /api/mobile/onboarding/gate {reached:true}: the user saw the onboarding
   * paywall. Recorded for every arm (onboarding_paywall_at, first time only);
   * the gate is set ONLY for onboarding_v2 `tour_hard` users while the
   * experiment is running or concluded — a paused (e.g. released) experiment
   * never locks anyone. Once set, the gate stays (re-lock on lapse, §11.3);
   * only the admin release-gate clears it.
   */
  static async reachPaywall(userId: string, now: Date = new Date()): Promise<{ gate: OnboardingGate }> {
    const supabase = createAdminSupabase();
    const { data: profile, error } = await supabase.from('profiles').select('onboarding_gate, onboarding_paywall_at').eq('id', userId).maybeSingle();
    if (error) throw new Error(`profiles read failed: ${error.message}`);
    const current: OnboardingGate = profile?.onboarding_gate === 'subscription_required' ? 'subscription_required' : 'none';

    const update: Record<string, unknown> = {};
    if (!profile?.onboarding_paywall_at) update.onboarding_paywall_at = now.toISOString();

    let gate = current;
    if (current === 'none') {
      const [assignment, experiment] = await Promise.all([
        ExperimentService.getAssignment(userId, ONBOARDING_EXPERIMENT_KEY),
        ExperimentService.get(ONBOARDING_EXPERIMENT_KEY),
      ]);
      const live = experiment?.status === 'running' || experiment?.status === 'concluded';
      if (assignment?.arm === HARD_GATE_ARM && live) {
        update.onboarding_gate = 'subscription_required';
        gate = 'subscription_required';
      }
    }
    if (Object.keys(update).length) {
      const { error: upErr } = await supabase.from('profiles').update(update).eq('id', userId);
      if (upErr) throw new Error(`profiles update failed: ${upErr.message}`);
    }
    return { gate };
  }
}
