/**
 * Draft meals (docs/ENGAGEMENT_115_SPEC.md §14.6).
 *
 *  - recordAnalysis   parse routes (after the response), 1.1.5+ clients only: hold the result
 *                     (and the photo) in meal_analysis_results, keyed by the `analysisId` the
 *                     response carried.
 *  - resolve          the client saved it (food-log create with `analysis_id`) or discarded it
 *                     (POST /api/mobile/food/analyses/{id}/discard).
 *  - promoteDue       cron, every 15 min: a result left pending 30 min becomes a Draft meal
 *                     (food_log_entries.entry_status = 'draft', private, counts nowhere).
 *  - cleanup          cron: drafts older than 14 days are deleted with their photos; resolved
 *                     analysis rows older than 14 days are dropped.
 *
 * Everything is a no-op while MEAL_DRAFTS_ENABLED is off (migration 139 not applied). Never
 * throws into a request: failures are logged.
 */
import { randomUUID } from 'node:crypto';

import { trackServerEventInBackground } from '../analytics/amplitude-server';
import { AnalyticsEvents } from '../analytics/events.generated';
import { type SupabaseClient } from '@supabase/supabase-js';

import { DRAFT_MAX_AGE_MS, DRAFT_PROMOTION_AFTER_MS, ENTRY_STATUS_DRAFT, isDraftEntry, mealDraftPromotionEnabled, mealDraftsEnabled, SUPERSEDE_WINDOW_MS } from '../meal-drafts/config';
import { draftEntryInput, promotionDecision, type AnalysisMethod } from '../meal-drafts/policy';
import { testAccountReason } from '../notifications/audience';
import { createAdminSupabase } from '../supabase-admin';
import type { CreateFoodLogEntryInput, FoodLogEntry } from '../types/food-log';
import type { NutritionDraftDTO } from '../types/nutrition';

import { FoodLogImageService } from './food-log-image-service';
import { FoodLogService, type DeferFn } from './food-log-service';

export const PENDING_BUCKET = 'food-logs';
const PROMOTE_BATCH = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AnalysisRow {
  id: string;
  user_id: string;
  method: AnalysisMethod;
  parse_hash: string | null;
  job_id: string | null;
  draft: Partial<NutritionDraftDTO> | null;
  image_paths: string[] | null;
  meal_type: string | null;
  timezone: string | null;
  captured_at: string;
  status: string;
  entry_id: string | null;
  created_at: string;
}

export interface PromotionSummary {
  enabled: boolean;
  scanned: number;
  drafted: number;
  superseded: number;
  expired: number;
  waiting: number;
  errors: number;
}

const extOf = (mime: string) => (mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('heic') || mime.includes('heif') ? 'heic' : 'jpg');
const mimeOf = (path: string) => (path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : path.endsWith('.heic') ? 'image/heic' : 'image/jpeg');

export function isAnalysisId(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

export class MealDraftService {
  /** A new analysis id for a parse response (only when the client may get drafts). */
  static newAnalysisId(): string {
    return randomUUID();
  }

  /** Hold one successful analysis until it is saved, discarded or becomes a draft. Never throws. */
  static async recordAnalysis(a: {
    id: string;
    userId: string;
    method: AnalysisMethod;
    draft: NutritionDraftDTO;
    jobId?: string;
    timezone?: string | null;
    images?: Array<{ bytes: Buffer; mimeType: string }>;
    now?: Date;
  }): Promise<void> {
    if (!mealDraftsEnabled()) return;
    try {
      const db = createAdminSupabase();
      const paths: string[] = [];
      for (const [i, img] of (a.images ?? []).entries()) {
        const path = `pending/${a.userId}/${a.id}/${i}.${extOf(img.mimeType)}`;
        const { error } = await db.storage.from(PENDING_BUCKET).upload(path, img.bytes, { contentType: img.mimeType, upsert: true });
        if (error) console.warn('[MealDraftService] pending photo upload failed:', a.id, error.message);
        else paths.push(path);
      }
      const { items, totals, overallConfidence, healthScore, assumptions, model, inputMethod, nutritionSource, parseHash, notes } = a.draft;
      const { error } = await db.from('meal_analysis_results').insert({
        id: a.id,
        user_id: a.userId,
        method: a.method,
        parse_hash: parseHash ?? null,
        job_id: a.jobId ?? null,
        draft: { items, totals, overallConfidence, healthScore, assumptions, model, inputMethod, nutritionSource, parseHash, notes },
        image_paths: paths,
        timezone: a.timezone ?? null,
        captured_at: (a.now ?? new Date()).toISOString(),
        created_at: (a.now ?? new Date()).toISOString(),
        status: 'pending',
      });
      if (error) {
        console.error('[MealDraftService] recordAnalysis insert failed:', a.id, error.message);
        if (paths.length) await db.storage.from(PENDING_BUCKET).remove(paths);
      }
    } catch (err: any) {
      console.error('[MealDraftService] recordAnalysis failed:', a.id, err?.message ?? err);
    }
  }

  /**
   * The user saved (`saved`, with the new entry id) or discarded the analysis. Only a pending row
   * of this user changes; the held photo is removed. Returns whether a row changed. Never throws.
   */
  static async resolve(userId: string, analysisId: string, status: 'saved' | 'discarded', entryId?: string | null): Promise<boolean> {
    if (!mealDraftsEnabled() || !isAnalysisId(analysisId)) return false;
    try {
      const db = createAdminSupabase();
      const { data, error } = await db
        .from('meal_analysis_results')
        .update({ status, resolved_at: new Date().toISOString(), ...(entryId ? { entry_id: entryId } : {}) })
        .eq('id', analysisId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select('image_paths');
      if (error) throw error;
      const row = ((data ?? []) as Array<{ image_paths: string[] | null }>)[0];
      if (row?.image_paths?.length) await db.storage.from(PENDING_BUCKET).remove(row.image_paths);
      return !!row;
    } catch (err: any) {
      console.error('[MealDraftService] resolve failed:', analysisId, err?.message ?? err);
      return false;
    }
  }

  /**
   * Food-log create with `analysis_id` (the client saved the result). Runs BEFORE the insert:
   *  - pending  → marked `saved` here (status-guarded), photo dropped: the cron can no longer
   *               promote it; the route then creates the entry and links it (linkSaved).
   *  - drafted  → the cron already turned it into a draft (`entryId`): the route saves onto
   *               that entry (saveOntoDraft) instead of inserting a second copy.
   *  - none     → unknown / someone else's / discarded / drafts off: a plain create.
   */
  static async claimForSave(userId: string, analysisId: string): Promise<{ kind: 'pending' } | { kind: 'drafted'; entryId: string } | { kind: 'none' }> {
    if (!mealDraftsEnabled() || !isAnalysisId(analysisId)) return { kind: 'none' };
    try {
      const db = createAdminSupabase();
      const { data, error } = await db
        .from('meal_analysis_results')
        .update({ status: 'saved', resolved_at: new Date().toISOString() })
        .eq('id', analysisId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select('image_paths');
      if (error) throw error;
      const row = ((data ?? []) as Array<{ image_paths: string[] | null }>)[0];
      if (row) {
        if (row.image_paths?.length) await db.storage.from(PENDING_BUCKET).remove(row.image_paths);
        return { kind: 'pending' };
      }
      const { data: existing, error: readError } = await db
        .from('meal_analysis_results')
        .select('status, entry_id')
        .eq('id', analysisId)
        .eq('user_id', userId)
        .maybeSingle();
      if (readError) throw readError;
      const r = existing as { status?: string; entry_id?: string | null } | null;
      return r?.status === 'drafted' && r.entry_id ? { kind: 'drafted', entryId: r.entry_id } : { kind: 'none' };
    } catch (err: any) {
      console.error('[MealDraftService] claimForSave failed (plain create):', analysisId, err?.message ?? err);
      return { kind: 'none' };
    }
  }

  /** After a create claimed with `pending`: remember which entry the save produced. Never throws. */
  static async linkSaved(userId: string, analysisId: string, entryId: string): Promise<void> {
    try {
      await createAdminSupabase().from('meal_analysis_results').update({ entry_id: entryId }).eq('id', analysisId).eq('user_id', userId).eq('status', 'saved');
    } catch (err: any) {
      console.error('[MealDraftService] linkSaved failed:', analysisId, err?.message ?? err);
    }
  }

  /**
   * The client saved an analysis that had already become a draft (claimForSave → drafted):
   * confirm THAT entry with the submitted content instead of inserting a copy. Returns the same
   * shape as FoodLogService.createEntry (`duplicate` = it was already confirmed: nothing ran again).
   *  - still a draft        → confirmDraft (edits, privacy like a create, meal card).
   *  - already confirmed    → that entry, duplicate.
   *  - not there yet        → the promotion is mid-flight: insert with the draft's id; if the cron
   *                           won that race the insert finds the draft and confirms it.
   *  - the user deleted it  → a fresh entry (there is no other copy).
   */
  static async saveOntoDraft(
    userId: string,
    entryId: string,
    data: CreateFoodLogEntryInput,
    supabase: SupabaseClient,
    opts: { defer?: DeferFn; shareByDefault?: boolean } = {}
  ): Promise<{ data: FoodLogEntry | null; error: Error | null; duplicate?: boolean; conflict?: boolean }> {
    // A draft keeps its capture time; water / supplement fields never apply to a meal.
    const { entry_type: _t, logged_at: _l, entry_date: _d, water_ml: _w, supplement_name: _sn, supplement_dosage: _sd, share_seen_circle_ids: _seen, ...edits } = data;
    void _t; void _l; void _d; void _w; void _sn; void _sd; void _seen;
    const confirm = async () => {
      const c = await FoodLogService.confirmDraft(entryId, userId, edits, supabase, opts);
      if (c.data) return { data: c.data, error: null, ...(c.alreadyConfirmed ? { duplicate: true } : {}) };
      return c.failure === 'NOT_FOUND' ? null : { data: null, error: c.error ?? new Error('confirm failed') };
    };
    const first = await confirm();
    if (first) return first;
    const created = await FoodLogService.createEntry(userId, data, supabase, { id: entryId, defer: opts.defer, shareByDefault: opts.shareByDefault });
    if (created.duplicate && created.data) {
      if (created.data.deleted_at) return FoodLogService.createEntry(userId, data, supabase, { defer: opts.defer, shareByDefault: opts.shareByDefault });
      if (isDraftEntry(created.data)) return (await confirm()) ?? { data: null, error: new Error('draft vanished') };
    }
    return created;
  }

  /** Cron: turn pending analyses older than 30 min into Draft meals. */
  static async promoteDue(now: Date = new Date()): Promise<PromotionSummary> {
    const summary: PromotionSummary = { enabled: mealDraftPromotionEnabled(), scanned: 0, drafted: 0, superseded: 0, expired: 0, waiting: 0, errors: 0 };
    if (!summary.enabled) return summary;
    const db = createAdminSupabase();
    const { data, error } = await db
      .from('meal_analysis_results')
      .select('id, user_id, method, parse_hash, job_id, draft, image_paths, meal_type, timezone, captured_at, status, entry_id, created_at')
      .eq('status', 'pending')
      .lte('created_at', new Date(now.getTime() - DRAFT_PROMOTION_AFTER_MS).toISOString())
      .order('created_at', { ascending: true })
      .limit(PROMOTE_BATCH);
    if (error) throw new Error(`meal draft candidates read failed: ${error.message}`);
    const rows = (data ?? []) as AnalysisRow[];
    summary.scanned = rows.length;
    const testUsers = await this.testUsers(rows.map((r) => r.user_id));

    for (const row of rows) {
      try {
        const outcome = await this.promoteOne(row, now, testUsers.has(row.user_id));
        if (outcome === 'promote') summary.drafted++;
        else if (outcome === 'superseded') summary.superseded++;
        else if (outcome === 'expired') summary.expired++;
        else summary.waiting++;
      } catch (err: any) {
        summary.errors++;
        console.error('[MealDraftService] promote failed:', row.id, err?.message ?? err);
      }
    }
    if (summary.scanned) console.log('[MealDraftService] promoteDue', JSON.stringify(summary));
    return summary;
  }

  /** One pending analysis → draft / superseded / expired / wait. */
  static async promoteOne(row: AnalysisRow, now: Date, isTestUser = false): Promise<ReturnType<typeof promotionDecision>> {
    const db = createAdminSupabase();
    const windowEnd = new Date(Date.parse(row.created_at) + Math.max(SUPERSEDE_WINDOW_MS, DRAFT_PROMOTION_AFTER_MS)).toISOString();
    const [newer, saved] = await Promise.all([
      db
        .from('meal_analysis_results')
        .select('created_at')
        .eq('user_id', row.user_id)
        .gt('created_at', row.created_at)
        .lte('created_at', windowEnd)
        .order('created_at', { ascending: true })
        .limit(1),
      // A food entry saved after this analysis that is not linked to ANY analysis (an old-style or
      // manual save of probably the same meal): never also make a draft of it.
      db
        .from('food_log_entries')
        .select('id, created_at')
        .eq('user_id', row.user_id)
        .eq('entry_type', 'food')
        .eq('entry_status', 'confirmed')
        .is('deleted_at', null)
        .gt('created_at', row.created_at)
        .lte('created_at', windowEnd)
        .order('created_at', { ascending: true })
        .limit(5),
    ]);
    if (newer.error) throw newer.error;
    if (saved.error) throw saved.error;
    const savedRows = (saved.data ?? []) as Array<{ id: string; created_at: string }>;
    let unlinkedSaveAt: string | null = null;
    if (savedRows.length) {
      const { data: linked, error: linkedError } = await db
        .from('meal_analysis_results')
        .select('entry_id')
        .eq('user_id', row.user_id)
        .in('entry_id', savedRows.map((r) => r.id));
      if (linkedError) throw linkedError;
      const linkedIds = new Set(((linked ?? []) as Array<{ entry_id: string | null }>).map((r) => r.entry_id));
      unlinkedSaveAt = savedRows.find((r) => !linkedIds.has(r.id))?.created_at ?? null;
    }

    const decision = promotionDecision({
      row,
      now,
      newerAnalysisAt: ((newer.data ?? []) as Array<{ created_at: string }>)[0]?.created_at ?? null,
      unlinkedFoodSaveAt: unlinkedSaveAt,
    });
    if (decision === 'wait') return decision;
    if (decision !== 'promote') {
      await this.close(row, decision);
      return decision;
    }

    // 1. Claim the row FIRST (status-guarded): a save / discard resolving it at the same moment
    //    wins or loses atomically, never both. The draft entry's id = the analysis id.
    const { data: claimed, error: claimError } = await db
      .from('meal_analysis_results')
      .update({ status: 'drafted', entry_id: row.id, resolved_at: now.toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id');
    if (claimError) throw claimError;
    if (((claimed ?? []) as unknown[]).length === 0) return 'superseded'; // resolved meanwhile

    // 2. Create the draft entry. A save that raced in after the claim (claimForSave → 'drafted')
    //    writes the SAME id, so whichever insert comes second finds the first (no second copy).
    const input = draftEntryInput({ draft: row.draft ?? {}, method: row.method, capturedAt: row.captured_at, timezone: row.timezone, mealType: row.meal_type });
    const created = await FoodLogService.createEntry(row.user_id, input, db, {
      id: row.id,
      draft: { method: row.method, analysisId: row.id, createdAt: now.toISOString() },
    });
    if (created.error || !created.data) {
      // Give the row back so the next run retries.
      await db.from('meal_analysis_results').update({ status: 'pending', entry_id: null, resolved_at: null }).eq('id', row.id).eq('status', 'drafted');
      throw created.error ?? new Error('draft entry not created');
    }
    const entryId = created.data.id;
    if (created.duplicate && !isDraftEntry(created.data)) {
      // The user saved it in the meantime (a confirmed entry with this id): nothing to draft.
      await db.from('meal_analysis_results').update({ status: 'saved' }).eq('id', row.id).eq('status', 'drafted');
      if (row.image_paths?.length) await db.storage.from(PENDING_BUCKET).remove(row.image_paths);
      return 'superseded';
    }

    if (!created.duplicate && row.image_paths?.length) await this.attachPhotos(row, entryId);
    if (row.image_paths?.length) await db.storage.from(PENDING_BUCKET).remove(row.image_paths);

    if (!isTestUser && !created.duplicate) {
      const e = AnalyticsEvents.mealDraftCreated({ method: row.method });
      trackServerEventInBackground(
        { event_type: e.name, user_id: row.user_id, event_properties: { ...e.properties } as Record<string, string | number | boolean>, insert_id: `meal-draft:${row.id}` },
        'meal-draft-created'
      );
    }
    return 'promote';
  }

  /** Cron: delete drafts older than 14 days (with photos) and old resolved analysis rows. */
  static async cleanup(now: Date = new Date()): Promise<{ draftsDeleted: number; analysesDeleted: number }> {
    const out = { draftsDeleted: 0, analysesDeleted: 0 };
    if (!mealDraftsEnabled()) return out;
    const db = createAdminSupabase();
    const cutoff = new Date(now.getTime() - DRAFT_MAX_AGE_MS).toISOString();

    const { data: drafts, error } = await db
      .from('food_log_entries')
      .select('id')
      .eq('entry_status', ENTRY_STATUS_DRAFT)
      .lt('draft_created_at', cutoff)
      .limit(500);
    if (error) throw new Error(`draft cleanup read failed: ${error.message}`);
    const ids = ((drafts ?? []) as Array<{ id: string }>).map((d) => d.id);
    if (ids.length) {
      const { data: images } = await db.from('food_log_images').select('storage_path, thumbnail_path, storage_bucket').in('food_log_entry_id', ids);
      const byBucket = new Map<string, string[]>();
      for (const img of (images ?? []) as Array<{ storage_path: string; thumbnail_path: string | null; storage_bucket: string }>) {
        const list = byBucket.get(img.storage_bucket) ?? [];
        list.push(img.storage_path, img.storage_path.replace('_original.', '_medium.'), ...(img.thumbnail_path ? [img.thumbnail_path] : []));
        byBucket.set(img.storage_bucket, list);
      }
      for (const [bucket, paths] of byBucket) await db.storage.from(bucket).remove(paths);
      await db.from('food_log_images').delete().in('food_log_entry_id', ids);
      // Only rows that are STILL drafts (a confirm racing the cleanup wins).
      const { error: delError } = await db.from('food_log_entries').delete().in('id', ids).eq('entry_status', ENTRY_STATUS_DRAFT);
      if (delError) throw new Error(`draft cleanup delete failed: ${delError.message}`);
      out.draftsDeleted = ids.length;
    }

    // Analysis rows: resolved ones after 14 days; pending ones past the backlog limit are expired
    // by promoteDue. Held photos of anything still around are removed with the row.
    const { data: old, error: oldError } = await db
      .from('meal_analysis_results')
      .select('id, image_paths')
      .lt('created_at', cutoff)
      .limit(500);
    if (oldError) throw new Error(`analysis cleanup read failed: ${oldError.message}`);
    const oldRows = (old ?? []) as Array<{ id: string; image_paths: string[] | null }>;
    const held = oldRows.flatMap((r) => r.image_paths ?? []);
    if (held.length) await db.storage.from(PENDING_BUCKET).remove(held);
    if (oldRows.length) {
      await db.from('meal_analysis_results').delete().in('id', oldRows.map((r) => r.id));
      out.analysesDeleted = oldRows.length;
    }
    return out;
  }

  // ------------------------------------------------------------------ private

  private static async close(row: AnalysisRow, decision: 'superseded' | 'expired'): Promise<void> {
    const db = createAdminSupabase();
    const { error } = await db
      .from('meal_analysis_results')
      .update({ status: decision, resolved_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending');
    if (error) throw error;
    if (row.image_paths?.length) await db.storage.from(PENDING_BUCKET).remove(row.image_paths);
  }

  private static async attachPhotos(row: AnalysisRow, entryId: string): Promise<void> {
    const db = createAdminSupabase();
    const files: File[] = [];
    for (const path of row.image_paths ?? []) {
      const { data, error } = await db.storage.from(PENDING_BUCKET).download(path);
      if (error || !data) {
        console.warn('[MealDraftService] pending photo missing:', path, error?.message);
        continue;
      }
      files.push(new File([await data.arrayBuffer()], path.split('/').pop() ?? 'photo.jpg', { type: mimeOf(path) }));
    }
    if (files.length === 0) return;
    const { failed } = await FoodLogImageService.uploadImages(entryId, row.user_id, files, db);
    if (failed.length) console.warn('[MealDraftService] draft photo attach failed:', entryId, failed.length);
  }

  /** Test / robot accounts in this batch (no server analytics event for them). */
  private static async testUsers(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return out;
    try {
      const { data } = await createAdminSupabase().from('profiles').select('id, email, is_admin, metadata').in('id', unique);
      for (const p of (data ?? []) as Array<{ id: string; email: string | null; is_admin: boolean | null; metadata: Record<string, unknown> | null }>) {
        if (testAccountReason({ email: p.email, isAdmin: p.is_admin, metadata: p.metadata })) out.add(p.id);
      }
    } catch {
      /* unknown → treated as real */
    }
    return out;
  }
}
