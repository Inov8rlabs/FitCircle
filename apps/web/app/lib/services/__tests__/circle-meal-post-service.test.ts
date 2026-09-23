import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { CircleMealPostService } from '../circle-meal-post-service';
import { DailySummaryService } from '../daily-summary-service';

const meal = {
  id: 'e1',
  user_id: 'u1',
  entry_type: 'food', // what food_log_entries actually stores; the slot is meal_type
  visibility: 'circle',
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
  it("shares 'food' rows (the real entry_type) the owner left visible to circles, plus legacy meal/snack", () => {
    expect(CircleMealPostService.isShareableMeal(meal)).toBe(true);
    expect(CircleMealPostService.isShareableMeal({ ...meal, visibility: 'shared', meal_type: 'snack' })).toBe(true);
    expect(CircleMealPostService.isShareableMeal({ ...meal, entry_type: 'meal' })).toBe(true);
    expect(CircleMealPostService.isShareableMeal({ ...meal, entry_type: 'snack' })).toBe(true);
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

describe('DailySummaryService local-day timing', () => {
  it('summarizes only once the circle reaches its local evening', () => {
    expect(DailySummaryService.isSummaryHour(20)).toBe(false);
    expect(DailySummaryService.isSummaryHour(21)).toBe(true);
    expect(DailySummaryService.isSummaryHour(23)).toBe(true);
  });

  it("reads the hour in the circle's zone, not UTC (the old 20:00 UTC run was 16:00 Eastern)", () => {
    const run = new Date('2026-09-22T20:00:00Z');
    expect(DailySummaryService.localHour(run, 'America/New_York')).toBe(16);
    expect(DailySummaryService.localHour(run, 'UTC')).toBe(20);
    expect(DailySummaryService.localHour(new Date('2026-09-23T01:30:00Z'), 'America/New_York')).toBe(21);
  });

  it('falls back to Eastern for a missing or invalid circle timezone', () => {
    expect(DailySummaryService.circleTimezone(null)).toBe('America/New_York');
    expect(DailySummaryService.circleTimezone('Mars/Olympus')).toBe('America/New_York');
    expect(DailySummaryService.circleTimezone('America/Los_Angeles')).toBe('America/Los_Angeles');
  });
});
