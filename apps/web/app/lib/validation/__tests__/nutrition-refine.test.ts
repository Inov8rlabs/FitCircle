import { describe, expect, it } from 'vitest';

import { readRefineRequest } from '../nutrition-refine';

const form = (fields: Record<string, string>) => (key: string) => (key in fields ? fields[key] : null);

describe('readRefineRequest', () => {
  it('is null for a plain parse (no correction) and when the correction is blank', () => {
    expect(readRefineRequest(form({}))).toBeNull();
    expect(readRefineRequest(form({ correction: '   ', draft: '[]' }))).toBeNull();
  });

  it('parses correction, draft items and the previous parseHash', () => {
    const r = readRefineRequest(form({
      correction: '  the rice is brown rice ',
      draft: JSON.stringify([{ name: 'white rice', quantity: 1, servingUnit: 'cup', grams: 158, calories: 205, proteinG: 4, carbsG: 45, fatG: 0.4 }]),
      parseHash: 'ab12cd34ef56ab12cd34ef56',
    }));
    expect(r).toEqual({
      correction: 'the rice is brown rice',
      items: [{ name: 'white rice', quantity: 1, servingUnit: 'cup', grams: 158, calories: 205, proteinG: 4, carbsG: 45, fatG: 0.4 }],
      previousParseHash: 'ab12cd34ef56ab12cd34ef56',
    });
  });

  it('truncates a long correction, tolerates a missing draft, and rejects a malformed one', () => {
    const long = readRefineRequest(form({ correction: 'x'.repeat(900) }));
    expect(long && long !== 'invalid' ? long.correction.length : 0).toBe(500);
    expect(long && long !== 'invalid' ? long.items : null).toEqual([]);
    expect(readRefineRequest(form({ correction: 'no cheese', draft: '{not json' }))).toBe('invalid');
    expect(readRefineRequest(form({ correction: 'no cheese', draft: JSON.stringify([{ name: '' }]) }))).toBe('invalid');
    expect(readRefineRequest(form({ correction: 'no cheese', parseHash: 'not-a-hash' }))).toMatchObject({ previousParseHash: null });
  });
});
