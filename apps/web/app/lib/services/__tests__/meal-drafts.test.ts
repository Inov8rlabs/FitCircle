/**
 * Draft meals (ENGAGEMENT_115_SPEC §14.6): pure policy, switches, MealDraftService lifecycle
 * (record → resolve / promote → confirm → cleanup) and the draft guards in FoodLogService.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackServerEventInBackground } from '@/lib/analytics/amplitude-server';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { confirmedOnly, includeDraftsFor, mealDraftPromotionEnabled, mealDraftsEnabled } from '../../meal-drafts/config';
import { draftEntryInput, draftTitle, mealTypeAt, promotionDecision } from '../../meal-drafts/policy';
import { CircleMealPostService } from '../circle-meal-post-service';
import { FoodLogService } from '../food-log-service';
import { MealDraftService, type AnalysisRow } from '../meal-draft-service';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/lib/analytics/amplitude-server', async (orig) => ({
  ...(await orig<typeof import('@/lib/analytics/amplitude-server')>()),
  trackServerEventInBackground: vi.fn(),
}));

const U = '11111111-1111-4111-8111-111111111111';
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const NOW = new Date('2026-11-16T18:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const draftDto = (items = [{ name: 'Grilled chicken', calories: 400 }, { name: 'Rice', calories: 210 }]) => ({
  items,
  totals: { calories: 610, proteinG: 45, carbsG: 60, fatG: 12, fiberG: 4, sugarG: 2, sodiumMg: 500 },
  overallConfidence: 0.82,
  healthScore: 7,
  model: 'm',
  inputMethod: 'photo',
  nutritionSource: 'llm_vision',
  parseHash: 'h1',
});

let db: FakeSupabase;
let storage: { upload: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; download: ReturnType<typeof vi.fn> };

const analysis = (over: Partial<AnalysisRow> = {}): AnalysisRow => ({
  id: A1,
  user_id: U,
  method: 'photo',
  parse_hash: 'h1',
  job_id: null,
  draft: draftDto() as any,
  image_paths: [],
  meal_type: null,
  timezone: 'America/New_York',
  captured_at: ago(40),
  status: 'pending',
  entry_id: null,
  created_at: ago(40),
  ...over,
});

beforeEach(() => {
  vi.stubEnv('MEAL_DRAFTS_ENABLED', 'true');
  db = new FakeSupabase({
    food_log_entries: { uniqueKey: ['id'] },
    meal_analysis_results: {},
    food_log_audit: {},
    food_log_images: {},
    profiles: { rows: [{ id: U, email: 'maya@gmail.com', is_admin: false, metadata: {}, preferences: {} }] },
  });
  storage = { upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }), download: vi.fn() };
  (db as any).storage = { from: () => storage };
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  vi.mocked(trackServerEventInBackground).mockReset();
  vi.spyOn(CircleMealPostService, 'onMealLogged').mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('switches', () => {
  it('drafts default OFF (migration 139 first); promotion follows drafts unless switched off', () => {
    expect(mealDraftsEnabled({} as any)).toBe(false);
    expect(mealDraftsEnabled({ MEAL_DRAFTS_ENABLED: 'true' } as any)).toBe(true);
    expect(mealDraftPromotionEnabled({ MEAL_DRAFTS_ENABLED: 'true' } as any)).toBe(true);
    expect(mealDraftPromotionEnabled({ MEAL_DRAFTS_ENABLED: 'true', MEAL_DRAFT_PROMOTION_ENABLED: 'false' } as any)).toBe(false);
    expect(mealDraftPromotionEnabled({ MEAL_DRAFT_PROMOTION_ENABLED: 'true' } as any)).toBe(false);
  });
  it('confirmedOnly adds entry_status = confirmed only while drafts are on', () => {
    const q = { eq: vi.fn().mockReturnThis() };
    confirmedOnly(q);
    expect(q.eq).toHaveBeenCalledWith('entry_status', 'confirmed');
    vi.stubEnv('MEAL_DRAFTS_ENABLED', 'false');
    const q2 = { eq: vi.fn().mockReturnThis() };
    confirmedOnly(q2);
    expect(q2.eq).not.toHaveBeenCalled();
  });
  it('includeDraftsFor: only X-Client-Features: meal_drafts (1.1.5+), only while on', () => {
    const req = (f?: string) => ({ headers: new Headers(f ? { 'x-client-features': f } : {}) });
    expect(includeDraftsFor(req('icon_keys, meal_drafts'))).toBe(true);
    expect(includeDraftsFor(req('icon_keys'))).toBe(false);
    expect(includeDraftsFor(req())).toBe(false);
    vi.stubEnv('MEAL_DRAFTS_ENABLED', 'false');
    expect(includeDraftsFor(req('meal_drafts'))).toBe(false);
  });
});

describe('policy', () => {
  const row = { created_at: ago(40), draft: draftDto() as any };
  it('waits 30 min, promotes, expires after 24 h or with no items', () => {
    expect(promotionDecision({ row: { ...row, created_at: ago(29) }, now: NOW })).toBe('wait');
    expect(promotionDecision({ row, now: NOW })).toBe('promote');
    expect(promotionDecision({ row: { ...row, created_at: ago(25 * 60) }, now: NOW })).toBe('expired');
    expect(promotionDecision({ row: { ...row, draft: { ...draftDto([]) } as any }, now: NOW })).toBe('expired');
  });
  it('a newer analysis within 15 min (re-scan / Fix) or an unlinked food save within 30 min supersedes it', () => {
    expect(promotionDecision({ row, now: NOW, newerAnalysisAt: ago(30) })).toBe('superseded');
    expect(promotionDecision({ row, now: NOW, newerAnalysisAt: ago(20) })).toBe('promote'); // 20 min after
    expect(promotionDecision({ row, now: NOW, unlinkedFoodSaveAt: ago(15) })).toBe('superseded');
    expect(promotionDecision({ row, now: NOW, unlinkedFoodSaveAt: ago(5) })).toBe('promote'); // 35 min after
  });
  it('meal slot in the user zone, title, entry shape (private, capture day)', () => {
    expect(mealTypeAt(new Date('2026-11-16T12:30:00Z'), 'America/New_York')).toBe('breakfast'); // 07:30
    expect(mealTypeAt(new Date('2026-11-16T17:30:00Z'), 'America/New_York')).toBe('lunch'); // 12:30
    expect(mealTypeAt(new Date('2026-11-16T23:30:00Z'), 'America/New_York')).toBe('dinner'); // 18:30
    expect(draftTitle([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }])).toBe('A, B + 2 more');
    const input = draftEntryInput({ draft: draftDto() as any, method: 'photo', capturedAt: '2026-11-17T03:30:00Z', timezone: 'America/New_York' });
    expect(input).toMatchObject({
      entry_type: 'food',
      entry_date: '2026-11-16', // 22:30 the previous local day
      meal_type: 'snack',
      title: 'Grilled chicken, Rice',
      is_private: true,
      share_with_circles: false,
      input_method: 'photo',
      nutrition_source: 'llm_vision',
      llm_confidence: 0.82,
    });
    expect(input.nutrition_data).toMatchObject({ calories: 610, protein_g: 45, items: expect.any(Array), health_score: 7 });
  });
});

describe('MealDraftService', () => {
  it('recordAnalysis holds the result + photo; resolve(saved) closes it and drops the photo; old rows never reopen', async () => {
    await MealDraftService.recordAnalysis({ id: A1, userId: U, method: 'photo', draft: draftDto() as any, images: [{ bytes: Buffer.from([1]), mimeType: 'image/jpeg' }], now: NOW });
    expect(storage.upload).toHaveBeenCalledWith(`pending/${U}/${A1}/0.jpg`, expect.any(Buffer), expect.anything());
    expect(db.getRows('meal_analysis_results')[0]).toMatchObject({ id: A1, status: 'pending', image_paths: [`pending/${U}/${A1}/0.jpg`] });
    expect(await MealDraftService.resolve(U, A1, 'saved', 'entry-1')).toBe(true);
    expect(db.getRows('meal_analysis_results')[0]).toMatchObject({ status: 'saved', entry_id: 'entry-1' });
    expect(storage.remove).toHaveBeenCalledWith([`pending/${U}/${A1}/0.jpg`]);
    expect(await MealDraftService.resolve(U, A1, 'discarded')).toBe(false);
    expect(await MealDraftService.resolve('someone-else', A1, 'discarded')).toBe(false);
  });

  it('everything is a no-op while drafts are off', async () => {
    vi.stubEnv('MEAL_DRAFTS_ENABLED', 'false');
    await MealDraftService.recordAnalysis({ id: A1, userId: U, method: 'photo', draft: draftDto() as any });
    expect(db.getRows('meal_analysis_results')).toHaveLength(0);
    expect((await MealDraftService.promoteDue(NOW)).enabled).toBe(false);
  });

  it('promoteDue: a 40-min-old pending result becomes a private draft entry (id = analysis id) + Meal Draft Created', async () => {
    db.seed('meal_analysis_results', [analysis()]);
    const s = await MealDraftService.promoteDue(NOW);
    expect(s).toMatchObject({ scanned: 1, drafted: 1 });
    const [entry] = db.getRows('food_log_entries');
    expect(entry).toMatchObject({
      id: A1,
      user_id: U,
      entry_status: 'draft',
      draft_method: 'photo',
      draft_analysis_id: A1,
      draft_created_at: NOW.toISOString(),
      is_private: true,
      visibility: 'private',
      calories: 610,
    });
    expect(db.getRows('meal_analysis_results')[0]).toMatchObject({ status: 'drafted', entry_id: A1 });
    expect(CircleMealPostService.onMealLogged).not.toHaveBeenCalled();
    expect(trackServerEventInBackground).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'Meal Draft Created', user_id: U, event_properties: { method: 'photo' } }),
      expect.any(String)
    );
    // A second run finds nothing pending.
    expect((await MealDraftService.promoteDue(NOW)).scanned).toBe(0);
  });

  it('a re-scan supersedes the older result; only the newest becomes a draft', async () => {
    db.seed('meal_analysis_results', [analysis(), analysis({ id: A2, created_at: ago(35), captured_at: ago(35) })]);
    const s = await MealDraftService.promoteDue(NOW);
    expect(s).toMatchObject({ superseded: 1, drafted: 1 });
    expect(db.getRows('food_log_entries').map((e) => e.id)).toEqual([A2]);
  });

  it('an unlinked food save right after the analysis (manual log of the same meal) → no draft; a linked save of ANOTHER analysis does not block', async () => {
    db.seed('meal_analysis_results', [analysis()]);
    db.seed('food_log_entries', [{ id: 'manual-1', user_id: U, entry_type: 'food', entry_status: 'confirmed', deleted_at: null, created_at: ago(35) }]);
    expect(await MealDraftService.promoteDue(NOW)).toMatchObject({ superseded: 1, drafted: 0 });

    db.getRows('meal_analysis_results')[0].status = 'pending';
    db.seed('meal_analysis_results', [analysis({ id: A2, status: 'saved', entry_id: 'manual-1', created_at: ago(60), captured_at: ago(60) })]);
    expect(await MealDraftService.promoteDue(NOW)).toMatchObject({ drafted: 1 });
  });

  it('test accounts get the draft but no analytics event', async () => {
    db.getRows('profiles')[0].email = 'qa@example.com';
    db.seed('meal_analysis_results', [analysis()]);
    expect((await MealDraftService.promoteDue(NOW)).drafted).toBe(1);
    expect(trackServerEventInBackground).not.toHaveBeenCalled();
  });

  it('MEAL_DRAFT_PROMOTION_ENABLED=false stops new drafts', async () => {
    vi.stubEnv('MEAL_DRAFT_PROMOTION_ENABLED', 'false');
    db.seed('meal_analysis_results', [analysis()]);
    expect(await MealDraftService.promoteDue(NOW)).toMatchObject({ enabled: false, drafted: 0 });
  });

  it('cleanup deletes drafts older than 14 days (not confirmed ones) and old analysis rows', async () => {
    const old = new Date(NOW.getTime() - 15 * 86_400_000).toISOString();
    db.seed('food_log_entries', [
      { id: 'd-old', user_id: U, entry_status: 'draft', draft_created_at: old },
      { id: 'd-new', user_id: U, entry_status: 'draft', draft_created_at: ago(60) },
      { id: 'c-old', user_id: U, entry_status: 'confirmed', draft_created_at: old },
    ]);
    db.seed('food_log_images', [{ id: 'i1', food_log_entry_id: 'd-old', storage_path: 'u/x_original.jpg', thumbnail_path: 'u/x_thumbnail.jpg', storage_bucket: 'food-logs' }]);
    db.seed('meal_analysis_results', [analysis({ id: A2, status: 'expired', created_at: old, image_paths: ['pending/x/0.jpg'] })]);
    const out = await MealDraftService.cleanup(NOW);
    expect(out).toEqual({ draftsDeleted: 1, analysesDeleted: 1 });
    expect(db.getRows('food_log_entries').map((e) => e.id)).toEqual(['d-new', 'c-old']);
    expect(db.getRows('food_log_images')).toHaveLength(0);
    expect(storage.remove).toHaveBeenCalledWith(['u/x_original.jpg', 'u/x_medium.jpg', 'u/x_thumbnail.jpg']);
  });
});

describe('FoodLogService draft guards', () => {
  const draftRow = () => ({
    id: A1,
    user_id: U,
    entry_type: 'food',
    entry_status: 'draft',
    is_private: true,
    visibility: 'private',
    deleted_at: null,
    logged_at: ago(90),
    entry_date: '2026-11-16',
    title: 'Grilled chicken, Rice',
  });

  it('lists hide drafts unless the client asked for them', async () => {
    db.seed('food_log_entries', [draftRow(), { ...draftRow(), id: 'c1', entry_status: 'confirmed' }]);
    expect((await FoodLogService.getEntries(U, {}, db as any)).data.map((e) => e.id)).toEqual(['c1']);
    expect((await FoodLogService.getEntries(U, { includeDrafts: true }, db as any)).data).toHaveLength(2);
    expect((await FoodLogService.getEntriesForDay(U, '2026-11-16', db as any)).data.map((e) => e.id)).toEqual(['c1']);
  });

  it('by id: the owner on a 1.1.5 client only; never anyone else', async () => {
    db.seed('food_log_entries', [draftRow()]);
    expect((await FoodLogService.getEntryById(A1, U, db as any, { includeDrafts: true })).data?.id).toBe(A1);
    expect((await FoodLogService.getEntryById(A1, U, db as any)).data).toBeNull();
    expect((await FoodLogService.getEntryById(A1, 'other-user', db as any, { includeDrafts: true })).data).toBeNull();
  });

  it('a draft is never a meal card, and PATCH cannot share it', async () => {
    expect(CircleMealPostService.isShareableMeal({ ...draftRow(), is_private: false, visibility: 'circle' } as any)).toBe(false);
    db.seed('food_log_entries', [draftRow()]);
    vi.spyOn(CircleMealPostService, 'onMealUpdated').mockResolvedValue(undefined);
    const res = await FoodLogService.updateEntry(A1, U, { title: 'Chicken bowl', share_with_circles: true } as any, db as any);
    expect(res.error).toBeNull();
    expect(db.getRows('food_log_entries')[0]).toMatchObject({ title: 'Chicken bowl', is_private: true, entry_status: 'draft' });
  });

  it('confirmDraft: edits, then confirmed with the share default, card posted once; idempotent', async () => {
    db.seed('food_log_entries', [draftRow()]);
    const first = await FoodLogService.confirmDraft(A1, U, { title: 'Chicken bowl', share_with_circles: true }, db as any, { shareByDefault: false });
    expect(first.error).toBeNull();
    expect(first.alreadyConfirmed).toBeUndefined();
    expect(db.getRows('food_log_entries')[0]).toMatchObject({ entry_status: 'confirmed', title: 'Chicken bowl', is_private: false, logged_at: ago(90) });
    expect(CircleMealPostService.onMealLogged).toHaveBeenCalledTimes(1);

    const again = await FoodLogService.confirmDraft(A1, U, {}, db as any);
    expect(again.alreadyConfirmed).toBe(true);
    expect(CircleMealPostService.onMealLogged).toHaveBeenCalledTimes(1);
    expect((await FoodLogService.confirmDraft(A1, 'other-user', {}, db as any)).failure).toBe('NOT_FOUND');
  });

  it('confirmDraft without a share choice uses the user default (private here)', async () => {
    db.seed('food_log_entries', [draftRow()]);
    await FoodLogService.confirmDraft(A1, U, {}, db as any, { shareByDefault: false });
    expect(db.getRows('food_log_entries')[0]).toMatchObject({ entry_status: 'confirmed', is_private: true });
    expect(CircleMealPostService.onMealLogged).not.toHaveBeenCalled();
  });
});

describe('save ↔ promotion races (claimForSave / saveOntoDraft / promoteOne)', () => {
  const C1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  const body = { entry_type: 'food' as const, title: 'Chicken bowl', meal_type: 'lunch' as const, nutrition_data: { calories: 590 }, entry_date: '2026-11-16' };

  it('save first: the pending result is claimed as saved, so the cron never drafts it', async () => {
    db.seed('meal_analysis_results', [analysis()]);
    expect(await MealDraftService.claimForSave(U, A1)).toEqual({ kind: 'pending' });
    expect(await MealDraftService.promoteDue(NOW)).toMatchObject({ scanned: 0, drafted: 0 });
    await MealDraftService.linkSaved(U, A1, C1);
    expect(db.getRows('meal_analysis_results')[0]).toMatchObject({ status: 'saved', entry_id: C1 });
  });

  it('cron first, then a save with analysis_id: the draft is confirmed with the submitted content, no second entry; a retry is a duplicate', async () => {
    db.seed('meal_analysis_results', [analysis()]);
    await MealDraftService.promoteDue(NOW);
    const link = await MealDraftService.claimForSave(U, A1);
    expect(link).toEqual({ kind: 'drafted', entryId: A1 });
    const saved = await MealDraftService.saveOntoDraft(U, A1, body, db as any, { shareByDefault: false });
    expect(saved.error).toBeNull();
    expect(saved.duplicate).toBeUndefined();
    expect(db.getRows('food_log_entries')).toHaveLength(1);
    expect(db.getRows('food_log_entries')[0]).toMatchObject({ id: A1, entry_status: 'confirmed', title: 'Chicken bowl', calories: 590, entry_date: '2026-11-16' });
    const again = await MealDraftService.saveOntoDraft(U, A1, body, db as any);
    expect(again.duplicate).toBe(true);
    expect(db.getRows('food_log_entries')).toHaveLength(1);
  });

  it('save while the promotion is mid-flight (claimed, entry not written yet): the save writes the id, the cron then finds it and drafts nothing', async () => {
    db.seed('meal_analysis_results', [analysis({ status: 'drafted', entry_id: A1 })]);
    const saved = await MealDraftService.saveOntoDraft(U, A1, body, db as any, { shareByDefault: false });
    expect(saved.data).toMatchObject({ id: A1 });
    expect(db.getRows('food_log_entries')[0].entry_status).not.toBe('draft');
    // The cron's insert with the same id now hits the saved entry.
    const row = analysis();
    db.getRows('meal_analysis_results')[0].status = 'pending'; // as if the claim had not landed yet
    expect(await MealDraftService.promoteOne(row, NOW)).toBe('superseded');
    expect(db.getRows('food_log_entries')).toHaveLength(1);
    expect(trackServerEventInBackground).not.toHaveBeenCalled();
  });

  it('the user deleted the draft, then saves from a stale review → one fresh entry', async () => {
    db.seed('meal_analysis_results', [analysis({ status: 'drafted', entry_id: A1 })]);
    db.seed('food_log_entries', [{ id: A1, user_id: U, entry_type: 'food', entry_status: 'draft', deleted_at: ago(5) }]);
    const saved = await MealDraftService.saveOntoDraft(U, A1, body, db as any, { shareByDefault: false });
    expect(saved.data?.id).not.toBe(A1);
    expect(db.getRows('food_log_entries').filter((e) => !e.deleted_at)).toHaveLength(1);
  });

  it('reverse race: a save resolves the row between the cron read and its claim → promoteOne drafts nothing', async () => {
    db.seed('meal_analysis_results', [analysis()]);
    const stale = analysis(); // what the cron read
    expect(await MealDraftService.claimForSave(U, A1)).toEqual({ kind: 'pending' });
    expect(await MealDraftService.promoteOne(stale, NOW)).toBe('superseded');
    expect(db.getRows('food_log_entries')).toHaveLength(0);
    expect(db.getRows('meal_analysis_results')[0].status).toBe('saved');
  });

  it('drafts off / unknown id → plain create path', async () => {
    expect(await MealDraftService.claimForSave(U, A2)).toEqual({ kind: 'none' });
    vi.stubEnv('MEAL_DRAFTS_ENABLED', 'false');
    db.seed('meal_analysis_results', [analysis()]);
    expect(await MealDraftService.claimForSave(U, A1)).toEqual({ kind: 'none' });
  });
});

describe('confirm with the 1.1.5 per-circle share list', () => {
  it('share_with_circles:true + share_circle_ids → shared to exactly those circles', async () => {
    const CIRCLE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    db.seed('food_log_entries', [{ id: A1, user_id: U, entry_type: 'food', entry_status: 'draft', is_private: true, visibility: 'private', deleted_at: null }]);
    const r = await FoodLogService.confirmDraft(A1, U, { nutrition_data: { calories: 500 }, notes: 'n', meal_type: 'dinner', share_with_circles: true, share_circle_ids: [CIRCLE, CIRCLE] }, db as any);
    expect(r.data).toMatchObject({ entry_status: 'confirmed', is_private: false, share_circle_ids: [CIRCLE], meal_type: 'dinner', notes: 'n' });
    expect(CircleMealPostService.onMealLogged).toHaveBeenCalledWith(expect.objectContaining({ share_circle_ids: [CIRCLE] }));
  });
});
