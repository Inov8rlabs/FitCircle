import { describe, expect, it } from 'vitest';

import { describesAmount } from '../food-text-amount';

describe('describesAmount', () => {
  it('is false for bare food names (the hint shows)', () => {
    for (const t of ['eggs', 'chicken biryani', 'latte', 'dal chawal', 'oatmeal with banana', 'Grilled salmon', '']) {
      expect(describesAmount(t)).toBe(false);
    }
  });

  it('is true for numbers, fractions, articles and measures', () => {
    for (const t of [
      '2 eggs',
      '200g salmon',
      '½ avocado',
      'a bowl of oatmeal',
      'an apple',
      'one slice pizza',
      'half a sandwich',
      'cup of rice',
      'Large latte',
      'glass of milk',
      '1 tbsp peanut butter',
    ]) {
      expect(describesAmount(t)).toBe(true);
    }
  });

  it('matches whole words only ("grilled" is not "g", "Atlantic" is not "a")', () => {
    expect(describesAmount('grilled chicken')).toBe(false);
    expect(describesAmount('Atlantic salmon')).toBe(false);
    expect(describesAmount('pancakes')).toBe(false);
  });
});
