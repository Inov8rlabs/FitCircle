import { type SupabaseClient } from '@supabase/supabase-js';

import { createAdminSupabase } from '../supabase-admin';
import {
  type BodyCompCreate,
  type BodyCompDerivedFlags,
  type BodyCompImportItem,
  type BodyCompImportRequest,
  type BodyCompImportResult,
  type BodyCompListQuery,
  type BodyCompListResponse,
  type BodyCompLog,
  type BodyCompSource,
  type BodyCompUpdate,
  type SegmentalData,
  BODY_COMP_SOURCES,
} from '../types/body-composition';

/**
 * BodyCompositionService — CRUD + platform import for body_composition_logs
 * (BODY_COMP_BUILD_CONTRACT §2). All units canonical metric (kg / kcal / percent-number).
 *
 * Server-owned rules (never client-side):
 *  - Derivation: fat_mass := weight × BF%/100, lean_mass := weight − fat_mass, when absent
 *    and derivable; derived fields are flagged in the DTO's `derived` map.
 *  - Upsert semantics: POST hitting the (user, measured_at, source) unique index updates
 *    that row instead of failing.
 *  - Weight continuity: any log carrying weight_kg upserts daily_tracking.weight_kg for
 *    that date — unless the user's same-day entry is marked is_override.
 *  - Import: idempotent by (user, source, source_external_id); platform samples within a
 *    10-minute window collapse into ONE log row (a smart scale writes weight + BF% + BMR
 *    as separate samples at the same instant).
 *
 * Body-comp data is PRIVATE-ONLY — it must never be joined into any social surface.
 */

const IMPORT_GROUP_WINDOW_MINUTES = 10;

interface BodyCompRow {
  id: string;
  user_id: string;
  measured_at: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  fat_mass_kg: number | null;
  skeletal_muscle_mass_kg: number | null;
  lean_body_mass_kg: number | null;
  body_water_kg: number | null;
  bone_mass_kg: number | null;
  visceral_fat_level: number | null;
  bmr_kcal: number | null;
  segmental: SegmentalData | null;
  source: BodyCompSource;
  source_external_id: string | null;
  photo_urls: string[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const ROW_COLUMNS =
  'id, user_id, measured_at, weight_kg, body_fat_pct, fat_mass_kg, skeletal_muscle_mass_kg, lean_body_mass_kg, body_water_kg, bone_mass_kg, visceral_fat_level, bmr_kcal, segmental, source, source_external_id, photo_urls, notes, created_at, updated_at';

// ============================================================================
// Pure derivation helpers (exported for unit tests)
// ============================================================================

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface DerivableMetrics {
  weightKg?: number | null;
  bodyFatPct?: number | null;
  fatMassKg?: number | null;
  leanBodyMassKg?: number | null;
}

/**
 * Complete the derivable metrics (contract "server derivation rules"):
 *  - fatMassKg := weightKg × bodyFatPct/100 when absent and both inputs present
 *  - leanBodyMassKg := weightKg − fatMassKg when absent and derivable
 * Returns the completed values; user-provided values are never overwritten.
 */
export function deriveBodyCompMetrics(input: DerivableMetrics): {
  fatMassKg: number | null;
  leanBodyMassKg: number | null;
} {
  let fatMassKg = input.fatMassKg ?? null;
  let leanBodyMassKg = input.leanBodyMassKg ?? null;
  const weightKg = input.weightKg ?? null;
  const bodyFatPct = input.bodyFatPct ?? null;

  if (fatMassKg == null && weightKg != null && bodyFatPct != null) {
    fatMassKg = round2((weightKg * bodyFatPct) / 100);
  }
  if (leanBodyMassKg == null && weightKg != null && fatMassKg != null) {
    leanBodyMassKg = round2(weightKg - fatMassKg);
  }
  return { fatMassKg, leanBodyMassKg };
}

/**
 * Which stored values match what the server would have derived? The schema stores no
 * derivation marker, so flags are recomputed: a value is flagged derived when it equals
 * the server derivation of its inputs to the cent (the derivation writes round2 values,
 * so this is deterministic; a user hand-entering the exact derived value is
 * indistinguishable and harmlessly flagged).
 */
export function computeDerivedFlags(values: DerivableMetrics): BodyCompDerivedFlags {
  const flags: BodyCompDerivedFlags = {};
  const { weightKg, bodyFatPct, fatMassKg, leanBodyMassKg } = values;
  if (weightKg != null && bodyFatPct != null && fatMassKg != null) {
    if (Math.abs(fatMassKg - round2((weightKg * bodyFatPct) / 100)) < 0.005) {
      flags.fatMassKg = true;
    }
  }
  if (weightKg != null && fatMassKg != null && leanBodyMassKg != null) {
    if (Math.abs(leanBodyMassKg - round2(weightKg - fatMassKg)) < 0.005) {
      flags.leanBodyMassKg = true;
    }
  }
  return flags;
}

/**
 * Calendar date (YYYY-MM-DD) of a measurement in ITS OWN UTC offset. Clients send
 * measuredAt as ISO 8601 with offset (`z.string().datetime({ offset: true })`), so
 * this is the user's LOCAL day — matching how the check-in flow keys
 * daily_tracking.tracking_date (client-provided local date). Offset-less or
 * Z-suffixed (e.g. DB-normalized) timestamps fall back to the UTC date.
 */
export function localDateOfMeasurement(measuredAt: string): string {
  const t = Date.parse(measuredAt);
  const offset = measuredAt.match(/([+-])(\d{2}):?(\d{2})$/);
  const offsetMs = offset
    ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000
    : 0;
  return new Date(t + offsetMs).toISOString().slice(0, 10);
}

// ============================================================================
// Pure import grouping (exported for unit tests)
// ============================================================================

export interface ImportGroup {
  measuredAt: string; // earliest sample in the group
  externalIds: string[];
  weightKg?: number;
  bodyFatPct?: number;
  leanBodyMassKg?: number;
  bmrKcal?: number;
}

/**
 * Collapse platform samples taken within `windowMinutes` of the group's first sample
 * into one group (one future log row). Items are processed in chronological order; the
 * earliest sample anchors the group's measuredAt, and for each metric the first
 * non-null sample wins.
 */
export function groupImportItems(
  items: BodyCompImportItem[],
  windowMinutes: number = IMPORT_GROUP_WINDOW_MINUTES
): ImportGroup[] {
  const windowMs = windowMinutes * 60_000;
  const sorted = [...items].sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));

  const groups: (ImportGroup & { startMs: number })[] = [];
  for (const item of sorted) {
    const t = Date.parse(item.measuredAt);
    const current = groups[groups.length - 1];
    if (!current || t - current.startMs > windowMs) {
      groups.push({
        startMs: t,
        measuredAt: item.measuredAt,
        externalIds: [item.externalId],
        weightKg: item.weightKg,
        bodyFatPct: item.bodyFatPct,
        leanBodyMassKg: item.leanBodyMassKg,
        bmrKcal: item.bmrKcal,
      });
    } else {
      current.externalIds.push(item.externalId);
      if (current.weightKg == null && item.weightKg != null) current.weightKg = item.weightKg;
      if (current.bodyFatPct == null && item.bodyFatPct != null) current.bodyFatPct = item.bodyFatPct;
      if (current.leanBodyMassKg == null && item.leanBodyMassKg != null) {
        current.leanBodyMassKg = item.leanBodyMassKg;
      }
      if (current.bmrKcal == null && item.bmrKcal != null) current.bmrKcal = item.bmrKcal;
    }
  }
  return groups.map(({ startMs: _startMs, ...group }) => group);
}

// ============================================================================
// Service
// ============================================================================

export class BodyCompositionService {
  /**
   * Create a log (POST /body-comp). Upsert semantics: a conflict on
   * (user, measured_at, source) updates that row; a conflict on
   * (user, source, source_external_id) updates the previously imported row.
   */
  static async createLog(userId: string, input: BodyCompCreate): Promise<BodyCompLog> {
    const supabase = createAdminSupabase();
    const { fatMassKg, leanBodyMassKg } = deriveBodyCompMetrics(input);

    const row = {
      user_id: userId,
      measured_at: input.measuredAt,
      weight_kg: input.weightKg ?? null,
      body_fat_pct: input.bodyFatPct ?? null,
      fat_mass_kg: fatMassKg,
      skeletal_muscle_mass_kg: input.skeletalMuscleMassKg ?? null,
      lean_body_mass_kg: leanBodyMassKg,
      body_water_kg: input.bodyWaterKg ?? null,
      bone_mass_kg: input.boneMassKg ?? null,
      visceral_fat_level: input.visceralFatLevel ?? null,
      bmr_kcal: input.bmrKcal ?? null,
      segmental: input.segmental ?? null,
      source: input.source,
      source_external_id: input.sourceExternalId ?? null,
      photo_urls: input.photoUrls ?? null,
      notes: input.notes ?? null,
    };

    let saved: BodyCompRow;
    const { data, error } = await supabase
      .from('body_composition_logs')
      .upsert(row, { onConflict: 'user_id,measured_at,source' })
      .select(ROW_COLUMNS)
      .single();

    if (error) {
      // The other unique index — (user, source, source_external_id) — can still fire
      // when a re-POST carries the same external id at a different measured_at.
      if (error.code === '23505' && input.sourceExternalId) {
        const { user_id: _u, source: _s, source_external_id: _e, ...updatable } = row;
        const { data: updated, error: updateError } = await supabase
          .from('body_composition_logs')
          .update(updatable)
          .eq('user_id', userId)
          .eq('source', input.source)
          .eq('source_external_id', input.sourceExternalId)
          .select(ROW_COLUMNS)
          .single();
        if (updateError || !updated) {
          throw new Error(`body-comp create failed: ${updateError?.message ?? 'conflict'}`);
        }
        saved = updated as BodyCompRow;
      } else {
        throw new Error(`body-comp create failed: ${error.message}`);
      }
    } else {
      saved = data as BodyCompRow;
    }

    if (saved.weight_kg != null) {
      // Use the CLIENT's measuredAt (not the DB-normalized UTC echo) so the daily
      // key reflects the user's local calendar day.
      await this.syncDailyWeight(userId, input.measuredAt, saved.weight_kg, supabase);
    }

    return toBodyCompLog(saved);
  }

  /** List logs (GET /body-comp), newest first, cursor-paginated by measuredAt. */
  static async listLogs(userId: string, query: BodyCompListQuery): Promise<BodyCompListResponse> {
    const supabase = createAdminSupabase();
    const limit = query.limit ?? 50;

    // Up to one row per source can share a measured_at (unique on user+time+source),
    // and the cursor is a bare timestamp filtered with a strict `<` — so a page must
    // never end in the middle of a tie group or the remaining tied rows would be
    // skipped forever. Over-fetch by the maximum tie size and extend the page through
    // the boundary group (a page may exceed `limit` by up to 5 rows).
    const maxTies = BODY_COMP_SOURCES.length;
    let q = supabase
      .from('body_composition_logs')
      .select(ROW_COLUMNS)
      .eq('user_id', userId)
      .order('measured_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + maxTies);
    if (query.start) q = q.gte('measured_at', query.start);
    if (query.end) q = q.lte('measured_at', query.end);
    if (query.before) q = q.lt('measured_at', query.before);

    const { data, error } = await q;
    if (error) throw new Error(`body-comp list failed: ${error.message}`);

    const rows = (data ?? []) as BodyCompRow[];
    const page = rows.slice(0, limit);
    for (let i = limit; i < rows.length; i++) {
      if (rows[i].measured_at !== page[page.length - 1]?.measured_at) break;
      page.push(rows[i]);
    }
    const hasMore = rows.length > page.length;
    const logs = page.map(toBodyCompLog);
    return {
      logs,
      hasMore,
      nextBefore: hasMore && logs.length > 0 ? logs[logs.length - 1].measuredAt : null,
    };
  }

  /** Most recent log (GET /body-comp/latest) or null. */
  static async getLatest(userId: string): Promise<BodyCompLog | null> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('body_composition_logs')
      .select(ROW_COLUMNS)
      .eq('user_id', userId)
      .order('measured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`body-comp latest failed: ${error.message}`);
    return data ? toBodyCompLog(data as BodyCompRow) : null;
  }

  /**
   * Partial update (PUT /body-comp/{id}). Previously DERIVED values are treated as
   * absent during the merge so they re-derive from the patched inputs (e.g. changing
   * weight recomputes a derived fat mass); explicitly provided values stick.
   */
  static async updateLog(userId: string, id: string, patch: BodyCompUpdate): Promise<BodyCompLog> {
    const supabase = createAdminSupabase();
    const { data: existing, error: fetchError } = await supabase
      .from('body_composition_logs')
      .select(ROW_COLUMNS)
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (fetchError) throw new Error(`body-comp update failed: ${fetchError.message}`);
    if (!existing) throw new Error('NOT_FOUND');
    const row = existing as BodyCompRow;

    const oldDerived = computeDerivedFlags({
      weightKg: row.weight_kg,
      bodyFatPct: row.body_fat_pct,
      fatMassKg: row.fat_mass_kg,
      leanBodyMassKg: row.lean_body_mass_kg,
    });

    // Merge patch over existing values (undefined = keep, null = clear); previously
    // derived fat/lean fall back to null so derivation runs again on the new inputs.
    const merged: DerivableMetrics = {
      weightKg: patch.weightKg !== undefined ? patch.weightKg : row.weight_kg,
      bodyFatPct: patch.bodyFatPct !== undefined ? patch.bodyFatPct : row.body_fat_pct,
      fatMassKg:
        patch.fatMassKg !== undefined ? patch.fatMassKg : oldDerived.fatMassKg ? null : row.fat_mass_kg,
      leanBodyMassKg:
        patch.leanBodyMassKg !== undefined
          ? patch.leanBodyMassKg
          : oldDerived.leanBodyMassKg
            ? null
            : row.lean_body_mass_kg,
    };
    const { fatMassKg, leanBodyMassKg } = deriveBodyCompMetrics(merged);

    const skeletalMuscleMassKg =
      patch.skeletalMuscleMassKg !== undefined ? patch.skeletalMuscleMassKg : row.skeletal_muscle_mass_kg;
    if (
      merged.weightKg == null &&
      merged.bodyFatPct == null &&
      skeletalMuscleMassKg == null &&
      fatMassKg == null
    ) {
      throw new Error('AT_LEAST_ONE_METRIC_REQUIRED');
    }

    const updatePayload: Record<string, unknown> = {
      weight_kg: merged.weightKg ?? null,
      body_fat_pct: merged.bodyFatPct ?? null,
      fat_mass_kg: fatMassKg,
      lean_body_mass_kg: leanBodyMassKg,
      skeletal_muscle_mass_kg: skeletalMuscleMassKg ?? null,
    };
    if (patch.measuredAt !== undefined) updatePayload.measured_at = patch.measuredAt;
    if (patch.bodyWaterKg !== undefined) updatePayload.body_water_kg = patch.bodyWaterKg;
    if (patch.boneMassKg !== undefined) updatePayload.bone_mass_kg = patch.boneMassKg;
    if (patch.visceralFatLevel !== undefined) updatePayload.visceral_fat_level = patch.visceralFatLevel;
    if (patch.bmrKcal !== undefined) updatePayload.bmr_kcal = patch.bmrKcal;
    if (patch.segmental !== undefined) updatePayload.segmental = patch.segmental;
    if (patch.notes !== undefined) updatePayload.notes = patch.notes;

    const { data: updated, error: updateError } = await supabase
      .from('body_composition_logs')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', userId)
      .select(ROW_COLUMNS)
      .single();
    if (updateError || !updated) {
      // Moving measuredAt onto another same-source row's timestamp hits the
      // (user, measured_at, source) unique index — a user action, not a server fault.
      if (updateError?.code === '23505') throw new Error('DUPLICATE_ENTRY');
      throw new Error(`body-comp update failed: ${updateError?.message ?? 'unknown'}`);
    }
    const savedRow = updated as BodyCompRow;

    if (savedRow.weight_kg != null) {
      // Prefer the client's patch timestamp (carries the user's UTC offset) over the
      // DB-normalized echo so the daily key reflects their local calendar day.
      await this.syncDailyWeight(
        userId,
        patch.measuredAt ?? savedRow.measured_at,
        savedRow.weight_kg,
        supabase
      );
    }

    return toBodyCompLog(savedRow);
  }

  /** Delete a log (DELETE /body-comp/{id}). Throws NOT_FOUND when nothing matched. */
  static async deleteLog(userId: string, id: string): Promise<{ deleted: true }> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('body_composition_logs')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select('id');
    if (error) throw new Error(`body-comp delete failed: ${error.message}`);
    if (!data || data.length === 0) throw new Error('NOT_FOUND');
    return { deleted: true };
  }

  /**
   * Idempotent platform import (POST /body-comp/import). Dedup by
   * (user, source, source_external_id); remaining samples are grouped into 10-minute
   * clusters, each merged into an existing same-window row or inserted as a new one.
   */
  static async importBatch(userId: string, req: BodyCompImportRequest): Promise<BodyCompImportResult> {
    const supabase = createAdminSupabase();
    const source: BodyCompSource = req.platform;
    const received = req.items.length;

    // Samples with no metric payload can never satisfy the ≥1-metric constraint.
    const usable = req.items.filter(
      (i) => i.weightKg != null || i.bodyFatPct != null || i.leanBodyMassKg != null || i.bmrKcal != null
    );

    // Already-imported external ids → skip.
    let seen = new Set<string>();
    if (usable.length > 0) {
      const { data: existing, error } = await supabase
        .from('body_composition_logs')
        .select('source_external_id')
        .eq('user_id', userId)
        .eq('source', source)
        .in(
          'source_external_id',
          usable.map((i) => i.externalId)
        );
      if (error) throw new Error(`body-comp import failed: ${error.message}`);
      seen = new Set((existing ?? []).map((r) => r.source_external_id as string));
    }
    const fresh = usable.filter((i) => !seen.has(i.externalId));

    const groups = groupImportItems(fresh);
    const windowMs = IMPORT_GROUP_WINDOW_MINUTES * 60_000;
    let imported = 0;

    for (const group of groups) {
      const groupTime = Date.parse(group.measuredAt);

      // A sample can arrive in a later sync than its siblings (e.g. BF% written after
      // weight): merge into an existing row of the same source within the window.
      const { data: nearRows, error: nearError } = await supabase
        .from('body_composition_logs')
        .select(ROW_COLUMNS)
        .eq('user_id', userId)
        .eq('source', source)
        .gte('measured_at', new Date(groupTime - windowMs).toISOString())
        .lte('measured_at', new Date(groupTime + windowMs).toISOString())
        .order('measured_at', { ascending: true })
        .limit(1);
      if (nearError) throw new Error(`body-comp import failed: ${nearError.message}`);
      const near = (nearRows?.[0] ?? null) as BodyCompRow | null;

      if (near) {
        // Merge: the EXISTING row's values win and incoming values only fill metrics
        // the row doesn't have yet. Only the group's FIRST external id fits the
        // source_external_id column, so sibling samples get re-sent on later syncs —
        // existing-wins keeps those re-sends (and any conflict with a user's PUT edit)
        // idempotent instead of clobbering the row.
        const nearDerived = computeDerivedFlags({
          weightKg: near.weight_kg,
          bodyFatPct: near.body_fat_pct,
          fatMassKg: near.fat_mass_kg,
          leanBodyMassKg: near.lean_body_mass_kg,
        });
        const mergedWeight = near.weight_kg ?? group.weightKg ?? null;
        const mergedBf = near.body_fat_pct ?? group.bodyFatPct ?? null;
        const mergedBmr = near.bmr_kcal ?? group.bmrKcal ?? null;
        const { fatMassKg, leanBodyMassKg } = deriveBodyCompMetrics({
          weightKg: mergedWeight,
          bodyFatPct: mergedBf,
          // Imports never carry fat mass, so a stored one is derived — recompute it.
          fatMassKg: nearDerived.fatMassKg ? null : near.fat_mass_kg,
          leanBodyMassKg: nearDerived.leanBodyMassKg
            ? group.leanBodyMassKg ?? null // derived lean yields to a real platform sample
            : near.lean_body_mass_kg ?? group.leanBodyMassKg,
        });

        // Nothing new to store (a fully re-sent group) → idempotent no-op, counted
        // as skipped so {received, imported, skipped} stays truthful on re-syncs.
        const changed =
          !numEquals(mergedWeight, near.weight_kg) ||
          !numEquals(mergedBf, near.body_fat_pct) ||
          !numEquals(fatMassKg, near.fat_mass_kg) ||
          !numEquals(leanBodyMassKg, near.lean_body_mass_kg) ||
          !numEquals(mergedBmr, near.bmr_kcal);
        if (!changed) continue;

        const { error } = await supabase
          .from('body_composition_logs')
          .update({
            weight_kg: mergedWeight,
            body_fat_pct: mergedBf,
            fat_mass_kg: fatMassKg,
            lean_body_mass_kg: leanBodyMassKg,
            bmr_kcal: mergedBmr,
          })
          .eq('id', near.id);
        if (error) throw new Error(`body-comp import failed: ${error.message}`);
        imported += group.externalIds.length;

        if (mergedWeight != null) {
          // group.measuredAt (same 10-min window as the row) keeps the client's UTC
          // offset, so the daily key lands on the user's local calendar day.
          await this.syncDailyWeight(userId, group.measuredAt, mergedWeight, supabase);
        }
      } else {
        // The DB requires ≥1 of weight/BF%/SMM/fat-mass (body_comp_has_metric), and
        // of that set an import can only supply weight or BF% — a lean/BMR-only group
        // with no same-window row to merge into cannot be stored yet. Leave it
        // unimported (counted skipped); a later sync merges it once a sibling
        // weight/BF% row exists.
        if (group.weightKg == null && group.bodyFatPct == null) continue;

        const { fatMassKg, leanBodyMassKg } = deriveBodyCompMetrics({
          weightKg: group.weightKg,
          bodyFatPct: group.bodyFatPct,
          leanBodyMassKg: group.leanBodyMassKg,
        });
        // Upsert on the measured_at index so a concurrent sync can't double-insert.
        const { error } = await supabase.from('body_composition_logs').upsert(
          {
            user_id: userId,
            measured_at: group.measuredAt,
            weight_kg: group.weightKg ?? null,
            body_fat_pct: group.bodyFatPct ?? null,
            fat_mass_kg: fatMassKg,
            lean_body_mass_kg: leanBodyMassKg,
            bmr_kcal: group.bmrKcal ?? null,
            source,
            source_external_id: group.externalIds[0],
          },
          { onConflict: 'user_id,measured_at,source' }
        );
        if (error) throw new Error(`body-comp import failed: ${error.message}`);
        imported += group.externalIds.length;

        if (group.weightKg != null) {
          await this.syncDailyWeight(userId, group.measuredAt, group.weightKg, supabase);
        }
      }
    }

    return { received, imported, skipped: received - imported };
  }

  /**
   * Weight continuity (contract §2 derivation rules): a body-comp weight also lands in
   * daily_tracking.weight_kg for that date. daily_tracking is keyed by the CLIENT'S
   * local date (the check-in flow sends trackingDate in the user's timezone), so the
   * day is derived from measuredAt's own UTC offset — an 8 PM Pacific weigh-in must
   * not land on the next day's row. UNLESS the user's same-day entry is marked
   * is_override (a manual override must never be clobbered by synced data).
   */
  private static async syncDailyWeight(
    userId: string,
    measuredAt: string,
    weightKg: number,
    supabase: SupabaseClient
  ): Promise<void> {
    try {
      const trackingDate = localDateOfMeasurement(measuredAt);
      const { data: existing } = await supabase
        .from('daily_tracking')
        .select('id, is_override')
        .eq('user_id', userId)
        .eq('tracking_date', trackingDate)
        .maybeSingle();

      if (existing) {
        if (existing.is_override) return;
        await supabase.from('daily_tracking').update({ weight_kg: weightKg }).eq('id', existing.id);
      } else {
        await supabase
          .from('daily_tracking')
          .insert({ user_id: userId, tracking_date: trackingDate, weight_kg: weightKg });
      }
    } catch (error: any) {
      // Continuity is best-effort — never fail the log write over it.
      console.error('[BodyComposition] daily_tracking weight sync failed:', error?.message);
    }
  }
}

// ============================================================================
// Row → DTO
// ============================================================================

/**
 * Server-side enforcement of the body_comp_segmental gate (contract non-negotiable
 * #2): when the gate resolves to allowed:false, routes strip segmental data from
 * every outgoing DTO (and drop it from incoming writes). Free-tier default keeps
 * this a no-op until Ani flips the gate.
 */
export function stripSegmentalData(log: BodyCompLog): BodyCompLog {
  if (log.segmental === undefined) return log;
  const { segmental: _segmental, ...rest } = log;
  return rest;
}

/** Null-aware numeric equality at derivation precision (round2 → half-cent slack). */
function numEquals(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < 0.005;
}

function toBodyCompLog(row: BodyCompRow): BodyCompLog {
  const derived = computeDerivedFlags({
    weightKg: row.weight_kg,
    bodyFatPct: row.body_fat_pct,
    fatMassKg: row.fat_mass_kg,
    leanBodyMassKg: row.lean_body_mass_kg,
  });
  return {
    id: row.id,
    measuredAt: row.measured_at,
    weightKg: row.weight_kg ?? undefined,
    bodyFatPct: row.body_fat_pct ?? undefined,
    fatMassKg: row.fat_mass_kg ?? undefined,
    skeletalMuscleMassKg: row.skeletal_muscle_mass_kg ?? undefined,
    leanBodyMassKg: row.lean_body_mass_kg ?? undefined,
    bodyWaterKg: row.body_water_kg ?? undefined,
    boneMassKg: row.bone_mass_kg ?? undefined,
    visceralFatLevel: row.visceral_fat_level ?? undefined,
    bmrKcal: row.bmr_kcal ?? undefined,
    segmental: row.segmental ?? undefined,
    source: row.source,
    notes: row.notes ?? undefined,
    photoUrls: row.photo_urls ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    derived,
  };
}
