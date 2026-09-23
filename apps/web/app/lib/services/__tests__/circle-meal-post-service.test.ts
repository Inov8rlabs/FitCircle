import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { CircleMealPostService } from '../circle-meal-post-service';
import { DailySummaryService } from '../daily-summary-service';

const meal = {
  id: 'e1',
  user_id: 'u1',
  entry_type: 'meal' as const,
  visibility: 'circle' as const,
  title: 'Pancakes with fruit',
  meal_type: 'breakfast' as const,
  logged_at: '2026-09-22T12:30:00.000Z',
  calories: 901.4,
  protein_g: 43,
  carbs_g: 50.2,
  fat_g: 57,
  has_images: true,
};

describe('CircleMealPostService.isShareableMeal', () => {
  it('shares meals and snacks the owner left visible to circles', () => {
    expect(CircleMealPostService.isShareableMeal(meal)).toBe(true);
    expect(CircleMealPostService.isShareableMeal({ ...meal, entry_type: 'snack', visibility: 'shared' })).toBe(true);
  });

  it('never shares private, deleted, water or supplement entries', () => {
    expect(CircleMealPostService.isShareableMeal({ ...meal, is_private: true })).toBe(false);
    expect(CircleMealPostService.isShareableMeal({ ...meal, visibility: 'private' })).toBe(false);
    expect(CircleMealPostService.isShareableMeal({ ...meal, deleted_at: '2026-09-22T13:00:00Z' })).toBe(false);
    expect(CircleMealPostService.isShareableMeal({ ...meal, entry_type: 'water' })).toBe(false);
    expect(CircleMealPostService.isShareableMeal({ ...meal, entry_type: 'supplement' })).toBe(false);
  });
});

describe('CircleMealPostService copy + payload', () => {
  it('renders the plain-text body every client can show', () => {
    expect(CircleMealPostService.renderBody('Anki', meal)).toBe('Anki logged breakfast: Pancakes with fruit');
    expect(CircleMealPostService.renderBody('Anki', { ...meal, meal_type: 'snack', title: '' })).toBe('Anki logged a snack');
    expect(CircleMealPostService.renderBody('Anki', { ...meal, meal_type: undefined, title: '' })).toBe('Anki logged a meal');
  });

  it('falls back to the first line of the description when there is no title', () => {
    expect(CircleMealPostService.titleOf({ ...meal, title: '', description: '• Chicken biryani\n• Raita' })).toBe(
      'Chicken biryani'
    );
  });

  it('builds a rounded snake_case payload with the proxy photo path', () => {
    expect(CircleMealPostService.buildPayload(meal, 'img-1')).toEqual({
      entry_id: 'e1',
      title: 'Pancakes with fruit',
      meal_type: 'breakfast',
      logged_at: '2026-09-22T12:30:00.000Z',
      calories: 901,
      protein_g: 43,
      carbs_g: 50,
      fat_g: 57,
      image_id: 'img-1',
      photo_path: '/api/mobile/food-log/images/img-1?size=medium',
    });
  });

  it('leaves the photo null until one is attached and tolerates missing macros', () => {
    const payload = CircleMealPostService.buildPayload({ ...meal, calories: undefined, fat_g: NaN }, null);
    expect(payload.image_id).toBeNull();
    expect(payload.photo_path).toBeNull();
    expect(payload.calories).toBeNull();
    expect(payload.fat_g).toBeNull();
  });
});

describe('DailySummaryService.shouldPostSummary', () => {
  it('posts only when at least one member checked in', () => {
    expect(DailySummaryService.shouldPostSummary(0, 2)).toBe(false);
    expect(DailySummaryService.shouldPostSummary(1, 2)).toBe(true);
    expect(DailySummaryService.shouldPostSummary(2, 2)).toBe(true);
    expect(DailySummaryService.shouldPostSummary(0, 0)).toBe(false);
  });
});
