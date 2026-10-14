import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal chainable Supabase mock: records every update payload per table and lets a test
// script the draft-row lookup result.
const state = {
  draft: null as any,
  updates: [] as Array<{ table: string; payload: any; filters: Record<string, unknown> }>,
  inserts: [] as Array<{ table: string; payload: any }>,
};

function chain(table: string) {
  const filters: Record<string, unknown> = {};
  const q: any = {
    select: () => q,
    eq: (k: string, v: unknown) => { filters[k] = v; return q; },
    is: (k: string, v: unknown) => { filters[`${k} is`] = v; return q; },
    in: () => q,
    gte: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: state.draft, error: null }),
    update: (payload: any) => { state.updates.push({ table, payload, filters }); return q; },
    insert: async (payload: any) => { state.inserts.push({ table, payload }); return { error: null }; },
    then: (resolve: (v: any) => void) => resolve({ data: null, error: null }),
  };
  return q;
}

vi.mock('../../supabase-admin', () => ({
  createAdminSupabase: () => ({ from: (table: string) => chain(table) }),
}));

import { NutritionTrainingService } from '../nutrition-training-service';

const draftRow = (overrides: Partial<any> = {}) => ({
  id: 'draft-1',
  created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  input_method: 'photo',
  overall_confidence: 0.72,
  parsed_items: [
    { name: 'grilled chicken breast', grams: 120, calories: 198 },
    { name: 'white rice', grams: 160, calories: 208 },
  ],
  draft_totals: { calories: 406, protein_g: 41 },
  ...overrides,
});

describe('NutritionTrainingService.reconcileEntry', () => {
  beforeEach(() => {
    process.env.NUTRITION_TRAINING_CAPTURE = 'true';
    state.draft = null;
    state.updates = [];
    state.inserts = [];
  });

  it('does nothing when capture is disabled', async () => {
    process.env.NUTRITION_TRAINING_CAPTURE = 'false';
    state.draft = draftRow();
    await NutritionTrainingService.reconcileEntry('u1', { id: 'e1', calories: 406 });
    expect(state.updates).toEqual([]);
  });

  it('no candidate draft → no writes', async () => {
    await NutritionTrainingService.reconcileEntry('u1', {
      id: 'e1', entry_type: 'food', calories: 406, nutrition_data: { items: [{ name: 'white rice' }] },
    });
    expect(state.updates).toEqual([]);
  });

  it('links an entry with an item breakdown, scores edits, stamps provenance', async () => {
    state.draft = draftRow();
    await NutritionTrainingService.reconcileEntry('u1', {
      id: 'e1',
      entry_type: 'food',
      calories: 300,
      protein_g: 30,
      nutrition_data: {
        calories: 300,
        items: [{ name: 'white rice', grams: 120, calories: 156, protein_g: 3 }],
      },
    });

    const sample = state.updates.find((u) => u.table === 'nutrition_training_samples');
    expect(sample).toBeTruthy();
    expect(sample!.filters).toMatchObject({ id: 'draft-1', 'reconciled_at is': null });
    expect(sample!.payload).toMatchObject({
      entry_id: 'e1',
      link_basis: 'items',
      was_edited: true,
      items_matched: 1,
      items_removed: 1,
      items_added: 0,
      items_renamed: 0,
      final_totals: { calories: 300, protein_g: 30 },
    });
    expect(sample!.payload.kcal_delta_pct).toBeCloseTo(-26.1, 1);
    expect(sample!.payload.grams_delta_pct).toBeCloseTo(25, 1);

    const entry = state.updates.find((u) => u.table === 'food_log_entries');
    expect(entry!.filters).toMatchObject({ id: 'e1', user_id: 'u1' });
    expect(entry!.payload).toEqual({
      input_method: 'photo',
      nutrition_source: 'llm_vision',
      llm_confidence: 0.72,
    });
  });

  it('explicit client provenance wins over the inferred values', async () => {
    state.draft = draftRow({ input_method: 'voice' });
    await NutritionTrainingService.reconcileEntry(
      'u1',
      { id: 'e1', entry_type: 'food', calories: 406, nutrition_data: { items: [{ name: 'white rice' }] } },
      { input_method: 'manual', nutrition_source: 'user', llm_confidence: 0.1 },
    );
    expect(state.updates.find((u) => u.table === 'food_log_entries')).toBeUndefined();
  });

  it('voice drafts stamp llm_voice', async () => {
    state.draft = draftRow({ input_method: 'voice' });
    await NutritionTrainingService.reconcileEntry('u1', {
      id: 'e1', entry_type: 'food', calories: 406, nutrition_data: { items: [{ name: 'white rice' }] },
    });
    expect(state.updates.find((u) => u.table === 'food_log_entries')!.payload).toMatchObject({
      input_method: 'voice', nutrition_source: 'llm_voice',
    });
  });

  it('totals-only entry: linked when saved soon after the parse …', async () => {
    state.draft = draftRow();
    await NutritionTrainingService.reconcileEntry('u1', { id: 'e1', entry_type: 'food', calories: 406 });
    const sample = state.updates.find((u) => u.table === 'nutrition_training_samples');
    expect(sample!.payload).toMatchObject({ link_basis: 'totals', was_edited: false, final_items: [] });
  });

  it('… but NOT when the draft is older than the totals-only window (likely a different meal)', async () => {
    state.draft = draftRow({ created_at: new Date(Date.now() - 45 * 60 * 1000).toISOString() });
    await NutritionTrainingService.reconcileEntry('u1', { id: 'e1', entry_type: 'food', calories: 406 });
    expect(state.updates).toEqual([]);
  });

  it('ignores water / supplement entries and entries with no nutrition at all', async () => {
    state.draft = draftRow();
    await NutritionTrainingService.reconcileEntry('u1', { id: 'e1', entry_type: 'water' });
    await NutritionTrainingService.reconcileEntry('u1', { id: 'e2', entry_type: 'food' });
    expect(state.updates).toEqual([]);
  });
});

describe('NutritionTrainingService.captureDraft', () => {
  beforeEach(() => {
    process.env.NUTRITION_TRAINING_CAPTURE = 'true';
    state.inserts = [];
  });

  it('writes an unreconciled draft row without an image', async () => {
    await NutritionTrainingService.captureDraft({
      userId: 'u1',
      latencyMs: 4321.7,
      imageCount: 2,
      draft: {
        items: [{ name: 'dal', grams: 180, calories: 200 } as any],
        overallConfidence: 0.8,
        notes: null,
        inputMethod: 'photo',
        nutritionSource: 'llm_vision',
        model: 'anthropic/claude-haiku-4.5',
        cached: false,
        totals: { calories: 200, proteinG: 12, carbsG: 30, fatG: 4, fiberG: 6, sugarG: 2, sodiumMg: 300 },
        healthScore: 7,
        parseHash: 'abc123',
      },
    });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].payload).toMatchObject({
      user_id: 'u1',
      input_method: 'photo',
      model: 'anthropic/claude-haiku-4.5',
      overall_confidence: 0.8,
      was_edited: false,
      final_items: null,
      parse_hash: 'abc123',
      draft_totals: { calories: 200, protein_g: 12, carbs_g: 30, fat_g: 4 },
      latency_ms: 4322,
      cached: false,
      image_count: 2,
    });
    expect(state.inserts[0].payload.image_path).toBeUndefined();
  });

  it('is a no-op when disabled', async () => {
    process.env.NUTRITION_TRAINING_CAPTURE = 'false';
    await NutritionTrainingService.captureDraft({ userId: 'u1', latencyMs: 1, imageCount: 1, draft: {} as any });
    expect(state.inserts).toEqual([]);
  });
});
