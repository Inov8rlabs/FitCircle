import { describe, expect, it } from 'vitest';

import { normalizeQuickLogCategory, QUICK_LOG_CATEGORIES, quickLogCategorySchema } from '../quick-log';

describe('quick-log category tolerance', () => {
  it('passes the six stored categories through unchanged', () => {
    for (const category of QUICK_LOG_CATEGORIES) {
      expect(quickLogCategorySchema.parse(category)).toBe(category);
    }
  });

  it('maps the categories the iOS brand table sends', () => {
    expect(normalizeQuickLogCategory('hiit')).toBe('cardio');
    expect(normalizeQuickLogCategory('cycling')).toBe('cardio');
    expect(normalizeQuickLogCategory('general')).toBe('other');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeQuickLogCategory(' HIIT ')).toBe('cardio');
    expect(normalizeQuickLogCategory('Strength')).toBe('strength');
  });

  it('maps an unknown category to other instead of failing', () => {
    expect(quickLogCategorySchema.parse('underwater_basket_weaving')).toBe('other');
  });

  it('only ever produces a category the database accepts', () => {
    for (const raw of ['hiit', 'cycling', 'general', 'yoga', 'gym', 'x', 'OUTDOOR']) {
      expect(QUICK_LOG_CATEGORIES).toContain(normalizeQuickLogCategory(raw));
    }
  });

  it('still rejects a missing or non-string category', () => {
    expect(quickLogCategorySchema.safeParse(undefined).success).toBe(false);
    expect(quickLogCategorySchema.safeParse(3).success).toBe(false);
    expect(quickLogCategorySchema.safeParse('').success).toBe(false);
  });
});
