/** Privacy-by-default switches (docs/PRIVACY_COMPLIANCE_SPEC.md §8): one module, values unchanged. */
import { describe, expect, it, vi } from 'vitest';

const flip = vi.hoisted(() => ({ on: false }));
vi.mock('../defaults', async (orig) => {
  const actual = await orig<any>();
  return {
    get PRIVACY_DEFAULTS() {
      return flip.on
        ? { shareMealsWithCircles: true, profileVisibility: 'private', showWeight: false, showProgress: false }
        : actual.PRIVACY_DEFAULTS;
    },
  };
});

import { parsePrivacyPrefs } from '../../circles/member-progress';
import { shareMealsByDefault } from '../../services/food-entry-privacy';
import { PRIVACY_DEFAULTS } from '../defaults';

describe('PRIVACY_DEFAULTS', () => {
  it('current values are unchanged: meals private, profile public, weight + progress shown', () => {
    flip.on = false;
    expect(PRIVACY_DEFAULTS).toEqual({ shareMealsWithCircles: false, profileVisibility: 'public', showWeight: true, showProgress: true });
    expect(shareMealsByDefault({})).toBe(false);
    expect(parsePrivacyPrefs({})).toEqual({ profile_visibility: 'public', show_weight: true, show_progress: true });
  });

  it('flipping the module changes the default for users who never chose, never for those who did', () => {
    flip.on = true;
    expect(shareMealsByDefault({})).toBe(true);
    expect(shareMealsByDefault({ privacy: { share_meals_with_circles: false } })).toBe(false);
    expect(shareMealsByDefault({ privacy: 'garbage' })).toBe(false); // odd shapes fail closed
    expect(parsePrivacyPrefs({})).toEqual({ profile_visibility: 'private', show_weight: false, show_progress: false });
    expect(parsePrivacyPrefs({ profile_visibility: 'public', show_weight: true })).toMatchObject({ profile_visibility: 'public', show_weight: true });
    flip.on = false;
  });
});
