/**
 * ExperimentService — assignment, exposure and admin management for the
 * internal experimentation system (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §6).
 *
 * Every table here is service-role only (RLS on, no policies). All rules are
 * pure (assign.ts, model.ts); this class only does I/O. Every admin change
 * writes an experiment_audit_log row.
 */
import { identifyInBackground, type AmplitudeIdentification } from '../analytics/amplitude-server';
import { CampaignError } from '../campaigns/http';
import { ComplimentaryGrantService } from '../services/complimentary-grant-service';
import { createAdminSupabase } from '../supabase-admin';

import { assignmentIdentify, exposureIdentify } from './analytics';
import { decideAssignment, type AssignmentContext, type AssignmentDecision } from './assign';
import {
  applyPatch,
  CONFLICT_STATUSES,
  experimentFromRow,
  experimentToRow,
  freeRanges,
  layerChanged,
  layerFromRow,
  newSalt,
  overlappingExperiments,
  publicExperiment,
  publicLayer,
  SLICE_HOLDING_STATUSES,
  type AssignmentReason,
  type CreateExperimentInput,
  type CreateLayerInput,
  type Experiment,
  type ExperimentLayer,
  type ExperimentStatus,
  type LayerRef,
  type OverrideInput,
  type PatchExperimentInput,
  type PatchLayerInput,
} from './model';
import type { ExperimentRequestInfo } from './request-info';

/** PostgREST caps a response at 1 000 rows; page through anything larger. */
const PAGE = 1000;

export interface ArmCounts {
  /** reason=bucket rows (randomised). */
  assigned: number;
  /** reason=bucket rows with first_exposed_at. */
  exposed: number;
  overrides: number;
  /** reason in (fallback, winner): served this arm but not analysed. */
  other: number;
}

export interface MobileAssignment {
  arm: string;
  payload: Record<string, unknown>;
  enrolled: boolean;
  /** The arm's human label (e.g. "Tour + hard paywall"); null if the arm has none. */
  name: string | null;
  /** Why this arm: bucket | override | fallback | winner | layer | layer_conflict (diagnostics; clients still route by payload). */
  reason: AssignmentReason;
}

export interface AssignmentRow {
  experiment_key: string;
  user_id: string;
  arm: string;
  reason: AssignmentReason;
  assigned_at: string;
  first_exposed_at: string | null;
  exposure_surface: string | null;
  platform: string | null;
  app_version: string | null;
  country: string | null;
  user_deleted_at: string | null;
}

export const notFoundExperiment = (key: string) => new CampaignError(404, 'NOT_FOUND', `Experiment "${key}" not found`);
export const notFoundLayer = (key: string) => new CampaignError(404, 'NOT_FOUND', `Layer "${key}" not found`);

/** Shown on a PATCH that moves a started experiment's layer / slice. */
export const STICKY_LAYER_WARNING =
  'Existing assignments are sticky: users already assigned keep their arm. The new layer/slice only affects users assigned from now on (randomised users of sibling experiments are still protected by the layer_conflict check).';

/** Audit rows for layers share experiment_audit_log, keyed `layer:<key>`. */
export const layerAuditKey = (key: string) => `layer:${key}`;

/** Run a paged select until a short page. `build` must return a fresh query each call. */
export async function selectAllPages<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message ?? String(error));
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export class ExperimentService {
  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  static async get(key: string): Promise<Experiment | null> {
    const { data, error } = await createAdminSupabase().from('experiments').select('*').eq('key', key).maybeSingle();
    if (error) throw new Error(`experiments read failed: ${error.message}`);
    return data ? experimentFromRow(data) : null;
  }

  static async require(key: string): Promise<Experiment> {
    const e = await this.get(key);
    if (!e) throw notFoundExperiment(key);
    return e;
  }

  /** The user's persisted assignment, or null. */
  static async getAssignment(userId: string, key: string): Promise<AssignmentRow | null> {
    const { data, error } = await createAdminSupabase()
      .from('experiment_assignments')
      .select('*')
      .eq('experiment_key', key)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`experiment_assignments read failed: ${error.message}`);
    return (data as AssignmentRow | null) ?? null;
  }

  static async listAssignments(key: string): Promise<AssignmentRow[]> {
    return selectAllPages<AssignmentRow>(() =>
      createAdminSupabase().from('experiment_assignments').select('*').eq('experiment_key', key).order('user_id', { ascending: true })
    );
  }

  static countByArm(experiment: Experiment, rows: readonly AssignmentRow[]): Record<string, ArmCounts> {
    const counts: Record<string, ArmCounts> = {};
    for (const a of experiment.arms) counts[a.key] = { assigned: 0, exposed: 0, overrides: 0, other: 0 };
    for (const r of rows) {
      const c = (counts[r.arm] ??= { assigned: 0, exposed: 0, overrides: 0, other: 0 });
      if (r.reason === 'bucket') {
        c.assigned++;
        if (r.first_exposed_at) c.exposed++;
      } else if (r.reason === 'override') c.overrides++;
      else c.other++;
    }
    return counts;
  }

  /** Admin list: every experiment (no salt) with per-arm counts. */
  static async list() {
    const { data, error } = await createAdminSupabase().from('experiments').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(`experiments read failed: ${error.message}`);
    const experiments = ((data ?? []) as Record<string, any>[]).map(experimentFromRow);
    return Promise.all(
      experiments.map(async (e) => ({ ...publicExperiment(e), counts: this.countByArm(e, await this.listAssignments(e.key)) }))
    );
  }

  /** Admin detail: experiment, counts, overrides (with emails) and the latest audit rows. */
  static async detail(key: string) {
    const e = await this.require(key);
    const supabase = createAdminSupabase();
    const [assignments, overrides, audit] = await Promise.all([
      this.listAssignments(key),
      this.listOverrides(key),
      supabase.from('experiment_audit_log').select('*').eq('experiment_key', key).order('at', { ascending: false }).limit(100),
    ]);
    return {
      experiment: publicExperiment(e),
      counts: this.countByArm(e, assignments),
      overrides,
      audit: ((audit.data ?? []) as Record<string, any>[]).map((r) => ({
        id: r.id,
        actor: r.actor ?? null,
        action: r.action,
        before: r.before ?? null,
        after: r.after ?? null,
        at: r.at,
      })),
    };
  }

  static async listOverrides(key: string) {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('experiment_overrides').select('*').eq('experiment_key', key).order('created_at', { ascending: true });
    if (error) throw new Error(`experiment_overrides read failed: ${error.message}`);
    const rows = (data ?? []) as Record<string, any>[];
    const ids = rows.map((r) => r.user_id);
    const emails = new Map<string, string | null>();
    if (ids.length) {
      const { data: profiles } = await supabase.from('profiles').select('id, email').in('id', ids);
      for (const p of (profiles ?? []) as { id: string; email: string | null }[]) emails.set(p.id, p.email ?? null);
    }
    return rows.map((r) => ({
      userId: r.user_id as string,
      email: emails.get(r.user_id) ?? null,
      arm: r.arm as string,
      note: (r.note as string | null) ?? null,
      createdBy: (r.created_by as string | null) ?? null,
      createdAt: (r.created_at as string | null) ?? null,
    }));
  }

  // -------------------------------------------------------------------------
  // Mobile: assign + exposure
  // -------------------------------------------------------------------------

  /**
   * POST /api/mobile/experiments/assign. Unknown keys are simply absent from the
   * result (the client then uses its default). Idempotent.
   */
  static async assign(
    profile: Record<string, any> & { id: string },
    keys: readonly string[],
    info: ExperimentRequestInfo,
    now: Date = new Date()
  ): Promise<Record<string, MobileAssignment>> {
    const supabase = createAdminSupabase();
    const unique = [...new Set(keys)];
    const [{ data: expRows, error: expErr }, { data: overrideRows }, { data: assignmentRows }, grant] = await Promise.all([
      supabase.from('experiments').select('*').in('key', unique),
      supabase.from('experiment_overrides').select('experiment_key, arm').eq('user_id', profile.id).in('experiment_key', unique),
      supabase.from('experiment_assignments').select('experiment_key, arm, reason').eq('user_id', profile.id).in('experiment_key', unique),
      ComplimentaryGrantService.activeGrant(profile.id).catch(() => null),
    ]);
    if (expErr) throw new Error(`experiments read failed: ${expErr.message}`);

    const ctx: AssignmentContext = {
      userId: profile.id,
      platform: info.platform,
      appVersion: info.appVersion,
      country: (typeof profile.country_code === 'string' && profile.country_code.trim() ? profile.country_code.trim().toUpperCase() : null) ?? info.ipCountry,
      profileCreatedAt: typeof profile.created_at === 'string' ? profile.created_at : null,
      onboardingCompleted: typeof profile.onboarding_completed === 'boolean' ? profile.onboarding_completed : profile.onboarding_completed == null ? false : null,
      hasComplimentaryGrant: !!grant,
      now,
    };

    const experiments: Experiment[] = [];
    for (const row of (expRows ?? []) as Record<string, any>[]) {
      try {
        experiments.push(experimentFromRow(row));
      } catch (err: any) {
        console.error(`[ExperimentService.assign] experiment ${row.key} is malformed:`, err?.message);
      }
    }
    const layers = await this.layerFacts(profile.id, experiments);

    const out: Record<string, MobileAssignment> = {};
    const identifies: AmplitudeIdentification[] = [];
    for (const experiment of experiments) {
      const override = ((overrideRows ?? []) as { experiment_key: string; arm: string }[]).find((o) => o.experiment_key === experiment.key) ?? null;
      const existing = ((assignmentRows ?? []) as { experiment_key: string; arm: string; reason: AssignmentReason }[]).find((a) => a.experiment_key === experiment.key) ?? null;
      const layer = experiment.layer
        ? {
            salt: layers.salts.get(experiment.layer.key) ?? null,
            conflict: [...(layers.enrolled.get(experiment.layer.key) ?? [])].some((k) => k !== experiment.key),
          }
        : null;
      const decision = decideAssignment(experiment, ctx, { override, existing, layer });
      if (decision.persist) await this.persist(experiment.key, ctx, decision, now);
      // Enrolling here blocks a sibling later in this same call.
      if (decision.persist && decision.reason === 'bucket' && experiment.layer) {
        const set = layers.enrolled.get(experiment.layer.key) ?? new Set<string>();
        set.add(experiment.key);
        layers.enrolled.set(experiment.layer.key, set);
      }
      const armDef = experiment.arms.find((a) => a.key === decision.arm);
      out[experiment.key] = {
        arm: decision.arm,
        payload: decision.payload,
        enrolled: decision.enrolled,
        name: armDef?.name ?? null,
        reason: decision.reason,
      };
      // exp_<key> = arm for randomised users and QA overrides only (re-sent on sticky calls: idempotent $set).
      const identify = assignmentIdentify(profile.id, experiment.key, { key: decision.arm, name: armDef?.name }, decision.reason);
      if (identify) identifies.push(identify);
    }
    identifyInBackground(identifies, 'experiment assignment');
    return out;
  }

  /**
   * For the layered experiments being assigned: each layer's salt, and the
   * experiments of each layer the user is already randomised into (reason
   * bucket) whose status is running or paused.
   */
  private static async layerFacts(
    userId: string,
    experiments: readonly Experiment[]
  ): Promise<{ salts: Map<string, string>; enrolled: Map<string, Set<string>> }> {
    const salts = new Map<string, string>();
    const enrolled = new Map<string, Set<string>>();
    const layerKeys = [...new Set(experiments.map((e) => e.layer?.key).filter((k): k is string => !!k))];
    if (!layerKeys.length) return { salts, enrolled };
    const supabase = createAdminSupabase();
    const [{ data: layerRows, error: layerErr }, { data: mine, error: mineErr }] = await Promise.all([
      supabase.from('experiment_layers').select('key, salt').in('key', layerKeys),
      supabase.from('experiment_assignments').select('experiment_key').eq('user_id', userId).eq('reason', 'bucket'),
    ]);
    if (layerErr) throw new Error(`experiment_layers read failed: ${layerErr.message}`);
    if (mineErr) throw new Error(`experiment_assignments read failed: ${mineErr.message}`);
    for (const l of (layerRows ?? []) as { key: string; salt: string }[]) salts.set(l.key, l.salt);
    const keys = ((mine ?? []) as { experiment_key: string }[]).map((r) => r.experiment_key);
    if (keys.length) {
      const { data: siblings, error } = await supabase.from('experiments').select('key, status, layer_key').in('key', keys);
      if (error) throw new Error(`experiments read failed: ${error.message}`);
      for (const e of (siblings ?? []) as { key: string; status: ExperimentStatus; layer_key: string | null }[]) {
        if (!e.layer_key || !layerKeys.includes(e.layer_key) || !CONFLICT_STATUSES.includes(e.status)) continue;
        const set = enrolled.get(e.layer_key) ?? new Set<string>();
        set.add(e.key);
        enrolled.set(e.layer_key, set);
      }
    }
    return { salts, enrolled };
  }

  private static async persist(key: string, ctx: AssignmentContext, d: AssignmentDecision, now: Date): Promise<void> {
    const row = {
      experiment_key: key,
      user_id: ctx.userId,
      arm: d.arm,
      reason: d.reason,
      assigned_at: now.toISOString(),
      platform: ctx.platform,
      app_version: ctx.appVersion,
      country: ctx.country,
    };
    const supabase = createAdminSupabase();
    // Overrides replace whatever was there (and reset exposure); everything else
    // is first-write-wins so a concurrent call can never move a user.
    const { error } =
      d.reason === 'override'
        ? await supabase
            .from('experiment_assignments')
            .upsert({ ...row, first_exposed_at: null, exposure_surface: null }, { onConflict: 'experiment_key,user_id' })
        : await supabase.from('experiment_assignments').upsert(row, { onConflict: 'experiment_key,user_id', ignoreDuplicates: true });
    if (error) throw new Error(`experiment_assignments write failed: ${error.message}`);
  }

  /**
   * POST /api/mobile/experiments/exposure. Sets first_exposed_at once, and only
   * when the reported arm is the user's persisted arm (a client that timed out
   * and fell back to control must not count as exposed to another arm).
   */
  static async recordExposure(userId: string, key: string, arm: string, surface: string, now: Date = new Date()): Promise<{ recorded: boolean }> {
    const existing = await this.getAssignment(userId, key);
    if (!existing || existing.arm !== arm || existing.first_exposed_at) return { recorded: false };
    const { error } = await createAdminSupabase()
      .from('experiment_assignments')
      .update({ first_exposed_at: now.toISOString(), exposure_surface: surface })
      .eq('experiment_key', key)
      .eq('user_id', userId)
      .is('first_exposed_at', null);
    if (error) throw new Error(`experiment_assignments exposure failed: ${error.message}`);
    identifyInBackground([exposureIdentify(userId, key, now)], 'experiment exposure');
    return { recorded: true };
  }

  // -------------------------------------------------------------------------
  // Admin writes (each audited)
  // -------------------------------------------------------------------------

  static async audit(key: string, actor: string | null, action: string, before: unknown, after: unknown): Promise<void> {
    const { error } = await createAdminSupabase()
      .from('experiment_audit_log')
      .insert({ experiment_key: key, actor, action, before: before ?? null, after: after ?? null });
    if (error) console.error('[ExperimentService.audit] insert failed:', error.message, key, action);
  }

  static async create(input: CreateExperimentInput, actor: string | null) {
    if (await this.get(input.key)) throw new CampaignError(409, 'DUPLICATE', `Experiment "${input.key}" already exists`);
    if (input.layer) await this.assertSliceFree({ key: input.key, layer: input.layer });
    const experiment: Omit<Experiment, 'createdAt' | 'updatedAt'> = {
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      status: 'draft',
      salt: newSalt(),
      arms: input.arms,
      trafficPct: input.trafficPct,
      audience: input.audience,
      fallbackArm: input.fallbackArm,
      winnerArm: null,
      layer: input.layer ?? null,
      startedAt: null,
      endedAt: null,
      createdBy: actor,
    };
    const { data, error } = await createAdminSupabase().from('experiments').insert(experimentToRow(experiment)).select('*').single();
    if (error) {
      if (error.code === '23505') throw new CampaignError(409, 'DUPLICATE', `Experiment "${input.key}" already exists`);
      throw new Error(`experiments insert failed: ${error.message}`);
    }
    const created = experimentFromRow(data);
    await this.audit(created.key, actor, 'create', null, publicExperiment(created));
    return this.detail(created.key);
  }

  /**
   * Weights, traffic and audience changes apply to NEW assignments only:
   * existing rows are never touched (sticky).
   */
  static async update(key: string, patch: PatchExperimentInput, actor: string | null, now: Date = new Date()) {
    const current = await this.require(key);
    const { count } = await createAdminSupabase()
      .from('experiment_assignments')
      .select('user_id', { count: 'exact', head: true })
      .eq('experiment_key', key);
    const next = applyPatch(current, patch, { now, hasAssignments: (count ?? 0) > 0 });
    const movedLayer = layerChanged(current.layer, next.layer);
    // A concluded experiment releases its slice, so it is never checked.
    if (next.layer && next.status !== 'concluded' && (movedLayer || patch.status !== undefined)) {
      await this.assertSliceFree({ key, layer: next.layer });
    }
    const warnings = movedLayer && current.status !== 'draft' ? [STICKY_LAYER_WARNING] : [];
    const { error } = await createAdminSupabase()
      .from('experiments')
      .update({ ...experimentToRow(next), updated_at: now.toISOString() })
      .eq('key', key);
    if (error) throw new Error(`experiments update failed: ${error.message}`);
    const action = patch.status !== undefined && patch.status !== current.status ? 'status' : movedLayer ? 'layer' : 'update';
    await this.audit(key, actor, action, publicExperiment(current), publicExperiment(next));
    return { ...(await this.detail(key)), warnings };
  }

  /** 400 UNKNOWN_LAYER / 409 LAYER_OVERLAP unless the slice is free in its layer. */
  private static async assertSliceFree(candidate: { key: string; layer: LayerRef }): Promise<void> {
    const supabase = createAdminSupabase();
    const { data: layer } = await supabase.from('experiment_layers').select('key').eq('key', candidate.layer.key).maybeSingle();
    if (!layer) throw new CampaignError(400, 'UNKNOWN_LAYER', `Layer "${candidate.layer.key}" does not exist`);
    const siblings = await this.experimentsInLayer(candidate.layer.key);
    const overlaps = overlappingExperiments(candidate, siblings);
    if (overlaps.length) {
      throw new CampaignError(
        409,
        'LAYER_OVERLAP',
        `Slice [${candidate.layer.start}, ${candidate.layer.end}) overlaps ${overlaps.map((o) => `${o.key} [${o.start}, ${o.end})`).join(', ')} in layer "${candidate.layer.key}"`,
        { overlaps }
      );
    }
  }

  private static async experimentsInLayer(layerKey: string): Promise<Experiment[]> {
    const { data, error } = await createAdminSupabase().from('experiments').select('*').eq('layer_key', layerKey);
    if (error) throw new Error(`experiments read failed: ${error.message}`);
    return ((data ?? []) as Record<string, any>[]).map(experimentFromRow);
  }

  // -------------------------------------------------------------------------
  // Layers (mutual exclusion groups)
  // -------------------------------------------------------------------------

  static async getLayer(key: string): Promise<ExperimentLayer | null> {
    const { data, error } = await createAdminSupabase().from('experiment_layers').select('*').eq('key', key).maybeSingle();
    if (error) throw new Error(`experiment_layers read failed: ${error.message}`);
    return data ? layerFromRow(data) : null;
  }

  /** Layer (no salt), its experiments with slices, and the unreserved ranges. */
  static async layerDetail(key: string) {
    const layer = await this.getLayer(key);
    if (!layer) throw notFoundLayer(key);
    const experiments = await this.experimentsInLayer(key);
    const rows = experiments
      .map((e) => ({
        key: e.key,
        name: e.name,
        status: e.status,
        start: e.layer!.start,
        end: e.layer!.end,
        trafficPct: e.trafficPct,
        holdsSlice: SLICE_HOLDING_STATUSES.includes(e.status),
      }))
      .sort((a, b) => a.start - b.start || a.key.localeCompare(b.key));
    return { layer: publicLayer(layer), experiments: rows, freeRanges: freeRanges(rows.filter((r) => r.holdsSlice)) };
  }

  static async listLayers() {
    const { data, error } = await createAdminSupabase().from('experiment_layers').select('*').order('created_at', { ascending: true });
    if (error) throw new Error(`experiment_layers read failed: ${error.message}`);
    return Promise.all(((data ?? []) as Record<string, any>[]).map((r) => this.layerDetail(r.key)));
  }

  static async createLayer(input: CreateLayerInput, actor: string | null) {
    if (await this.getLayer(input.key)) throw new CampaignError(409, 'DUPLICATE', `Layer "${input.key}" already exists`);
    const row = { key: input.key, name: input.name, description: input.description ?? null, salt: newSalt() };
    const { error } = await createAdminSupabase().from('experiment_layers').insert(row);
    if (error) {
      if (error.code === '23505') throw new CampaignError(409, 'DUPLICATE', `Layer "${input.key}" already exists`);
      throw new Error(`experiment_layers insert failed: ${error.message}`);
    }
    const { salt: _salt, ...audited } = row;
    await this.audit(layerAuditKey(input.key), actor, 'layer_create', null, audited);
    return this.layerDetail(input.key);
  }

  /** Name / description only — the salt is immutable. */
  static async updateLayer(key: string, patch: PatchLayerInput, actor: string | null, now: Date = new Date()) {
    const current = await this.getLayer(key);
    if (!current) throw notFoundLayer(key);
    const update: Record<string, unknown> = { updated_at: now.toISOString() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.description !== undefined) update.description = patch.description;
    const { error } = await createAdminSupabase().from('experiment_layers').update(update).eq('key', key);
    if (error) throw new Error(`experiment_layers update failed: ${error.message}`);
    await this.audit(layerAuditKey(key), actor, 'layer_update', publicLayer(current), { ...publicLayer(current), ...patch });
    return this.layerDetail(key);
  }

  private static async resolveUser(input: { email?: string; userId?: string }): Promise<{ id: string; email: string | null }> {
    const supabase = createAdminSupabase();
    let query = supabase.from('profiles').select('id, email');
    query = input.userId ? query.eq('id', input.userId) : query.ilike('email', input.email!.trim());
    const { data } = await query.limit(1).maybeSingle();
    if (!data) throw new CampaignError(404, 'USER_NOT_FOUND', 'No account matches that user id / email');
    return data as { id: string; email: string | null };
  }

  static async setOverride(key: string, input: OverrideInput, actor: string | null) {
    const experiment = await this.require(key);
    if (!experiment.arms.some((a) => a.key === input.arm)) throw new CampaignError(400, 'INVALID_ARM', `"${input.arm}" is not one of the arms`);
    const user = await this.resolveUser(input);
    const supabase = createAdminSupabase();
    const { data: before } = await supabase.from('experiment_overrides').select('*').eq('experiment_key', key).eq('user_id', user.id).maybeSingle();
    const row = { experiment_key: key, user_id: user.id, arm: input.arm, note: input.note ?? null, created_by: actor };
    const { error } = await supabase.from('experiment_overrides').upsert(row, { onConflict: 'experiment_key,user_id' });
    if (error) throw new Error(`experiment_overrides write failed: ${error.message}`);
    await this.audit(key, actor, 'override_set', before ?? null, { ...row, email: user.email });
    return { overrides: await this.listOverrides(key) };
  }

  /**
   * Removes the override and the override-made assignment, so the user's next
   * assign call runs the normal rules (an existing account is then simply
   * ineligible → fallback, unpersisted).
   */
  static async removeOverride(key: string, input: { email?: string; userId?: string }, actor: string | null) {
    await this.require(key);
    const user = await this.resolveUser(input);
    const supabase = createAdminSupabase();
    const { data: before } = await supabase.from('experiment_overrides').select('*').eq('experiment_key', key).eq('user_id', user.id).maybeSingle();
    if (!before) throw new CampaignError(404, 'NOT_FOUND', 'That user has no override for this experiment');
    await supabase.from('experiment_overrides').delete().eq('experiment_key', key).eq('user_id', user.id);
    await supabase.from('experiment_assignments').delete().eq('experiment_key', key).eq('user_id', user.id).eq('reason', 'override');
    await this.audit(key, actor, 'override_removed', { ...before, email: user.email }, null);
    return { overrides: await this.listOverrides(key) };
  }

  /**
   * Emergency (§5.5, §6.5): every `subscription_required` gate → `none`, and the
   * experiment is paused if it is running. Clients unlock on their next
   * entitlement refresh. Idempotent.
   */
  static async releaseGate(key: string, actor: string | null, now: Date = new Date()) {
    const experiment = await this.require(key);
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('profiles')
      .update({ onboarding_gate: 'none' })
      .eq('onboarding_gate', 'subscription_required')
      .select('id');
    if (error) throw new Error(`profiles gate release failed: ${error.message}`);
    const released = (data ?? []).length;
    let status = experiment.status;
    if (experiment.status === 'running') {
      const { error: pauseError } = await supabase
        .from('experiments')
        .update({ status: 'paused', updated_at: now.toISOString() })
        .eq('key', key);
      if (pauseError) throw new Error(`experiments pause failed: ${pauseError.message}`);
      status = 'paused';
    }
    await this.audit(key, actor, 'release_gate', { status: experiment.status }, { status, released });
    return { released, status };
  }

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------

  /** AccountDeletionService: keep the (anonymous) row, stamp the deletion. Never throws. */
  static async markUserDeleted(userId: string, now: Date = new Date()): Promise<void> {
    try {
      const { error } = await createAdminSupabase()
        .from('experiment_assignments')
        .update({ user_deleted_at: now.toISOString() })
        .eq('user_id', userId)
        .is('user_deleted_at', null);
      if (error) console.warn('[ExperimentService.markUserDeleted] failed:', error.message);
    } catch (err: any) {
      console.warn('[ExperimentService.markUserDeleted] failed:', err?.message);
    }
  }
}
