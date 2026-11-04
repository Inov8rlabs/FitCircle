import { describe, expect, it } from 'vitest';

import {
  isEntryPrivate,
  isRecentMeal,
  resolveCreatePrivacy,
  resolveUpdatePrivacy,
  scrubbedMealPayload,
  shareMealsByDefault,
} from '../food-entry-privacy';

const PRIV = { is_private: true, visibility: 'private' };
const SHARED = { is_private: false, visibility: 'circle' };

describe('resolveCreatePrivacy', () => {
  it('omitted fields → the user default, which is private unless turned on', () => {
    expect(resolveCreatePrivacy({ entry_type: 'food' }, false)).toEqual({ ...PRIV, source: 'default' });
    expect(resolveCreatePrivacy({ entry_type: 'food' }, true)).toEqual({ ...SHARED, source: 'default' });
  });

  it("a shipped client's hard-coded is_private:false / visibility:'circle' is NOT a choice", () => {
    // iOS 1.1.1 (is_private only) and Android 1.1.1 (both, encodeDefaults).
    expect(resolveCreatePrivacy({ entry_type: 'food', is_private: false }, false)).toEqual({ ...PRIV, source: 'default' });
    expect(resolveCreatePrivacy({ entry_type: 'food', is_private: false, visibility: 'circle' }, false)).toEqual({
      ...PRIV,
      source: 'default',
    });
    // …and with the default on, it shares because of the default, not the field.
    expect(resolveCreatePrivacy({ entry_type: 'food', is_private: false }, true).source).toBe('default');
  });

  it('a legacy request for privacy is always honoured, even with the default on', () => {
    expect(resolveCreatePrivacy({ entry_type: 'food', is_private: true }, true)).toEqual({ ...PRIV, source: 'legacy_private' });
    expect(resolveCreatePrivacy({ entry_type: 'food', visibility: 'private' }, true)).toEqual({
      ...PRIV,
      source: 'legacy_private',
    });
  });

  it('share_with_circles is the explicit choice and wins in both directions', () => {
    expect(resolveCreatePrivacy({ entry_type: 'food', share_with_circles: true }, false)).toEqual({ ...SHARED, source: 'explicit' });
    expect(resolveCreatePrivacy({ entry_type: 'food', share_with_circles: true, is_private: true }, false).is_private).toBe(false);
    expect(resolveCreatePrivacy({ entry_type: 'food', share_with_circles: false }, true)).toEqual({ ...PRIV, source: 'explicit' });
    expect(resolveCreatePrivacy({ entry_type: 'food', share_with_circles: true, visibility: 'shared' }, false)).toEqual({
      is_private: false,
      visibility: 'shared',
      source: 'explicit',
    });
  });

  it('water and supplements are never shared', () => {
    for (const entry_type of ['water', 'supplement']) {
      expect(resolveCreatePrivacy({ entry_type, share_with_circles: true }, true)).toEqual({ ...PRIV, source: 'never_shared_type' });
      expect(resolveCreatePrivacy({ entry_type, is_private: false }, true)).toEqual({ ...PRIV, source: 'never_shared_type' });
    }
  });
});

describe('resolveUpdatePrivacy', () => {
  const sharedRow = { entry_type: 'food', ...SHARED };
  const privateRow = { entry_type: 'food', ...PRIV };

  it('explicit toggle in both directions', () => {
    expect(resolveUpdatePrivacy({ share_with_circles: false }, sharedRow)).toEqual({ ...PRIV, source: 'explicit' });
    expect(resolveUpdatePrivacy({ share_with_circles: true }, privateRow)).toEqual({ ...SHARED, source: 'explicit' });
  });

  it('no-op when nothing changes', () => {
    expect(resolveUpdatePrivacy({ share_with_circles: true }, sharedRow)).toBeNull();
    expect(resolveUpdatePrivacy({ share_with_circles: false }, privateRow)).toBeNull();
    expect(resolveUpdatePrivacy({}, sharedRow)).toBeNull();
  });

  it('a shipped client re-sending is_private:false never re-shares a private entry', () => {
    expect(resolveUpdatePrivacy({ is_private: false, visibility: 'circle' }, privateRow)).toBeNull();
    expect(resolveUpdatePrivacy({ is_private: false }, privateRow)).toBeNull();
  });

  it('a legacy is_private:true makes a shared entry private', () => {
    expect(resolveUpdatePrivacy({ is_private: true }, sharedRow)).toEqual({ ...PRIV, source: 'legacy_private' });
  });

  it('normalises a half-private row when asked (is_private true, visibility circle)', () => {
    expect(resolveUpdatePrivacy({ share_with_circles: false }, { entry_type: 'food', is_private: true, visibility: 'circle' })).toEqual({
      ...PRIV,
      source: 'explicit',
    });
  });

  it('water stays private; untouched when the request carries no privacy field', () => {
    expect(resolveUpdatePrivacy({ share_with_circles: true }, { entry_type: 'water', ...SHARED })).toEqual({
      ...PRIV,
      source: 'never_shared_type',
    });
    expect(resolveUpdatePrivacy({}, { entry_type: 'water', ...SHARED })).toBeNull();
    expect(resolveUpdatePrivacy({ is_private: false }, { entry_type: 'water', ...PRIV })).toBeNull();
  });
});

describe('isEntryPrivate (fail closed)', () => {
  it('needs BOTH columns to say shared', () => {
    expect(isEntryPrivate(SHARED)).toBe(false);
    expect(isEntryPrivate({ is_private: false, visibility: 'shared' })).toBe(false);
    expect(isEntryPrivate({ is_private: true, visibility: 'circle' })).toBe(true);
    expect(isEntryPrivate({ is_private: false, visibility: 'private' })).toBe(true);
    expect(isEntryPrivate({ is_private: null, visibility: 'circle' })).toBe(true);
    expect(isEntryPrivate({ is_private: false, visibility: null })).toBe(true);
  });
});

describe('shareMealsByDefault', () => {
  it('only an explicit true turns it on', () => {
    expect(shareMealsByDefault(undefined)).toBe(false);
    expect(shareMealsByDefault({})).toBe(false);
    expect(shareMealsByDefault({ privacy: {} })).toBe(false);
    expect(shareMealsByDefault({ privacy: { share_meals_with_circles: 'yes' } })).toBe(false);
    expect(shareMealsByDefault({ privacy: { share_meals_with_circles: true } })).toBe(true);
  });
});

describe('isRecentMeal (push window)', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  it('pushes only for meals eaten within the last 2 hours', () => {
    expect(isRecentMeal('2026-11-03T11:00:00Z', now)).toBe(true);
    expect(isRecentMeal('2026-11-03T10:00:00Z', now)).toBe(true);
    expect(isRecentMeal('2026-11-03T09:59:59Z', now)).toBe(false);
    expect(isRecentMeal('2026-11-02T19:00:00Z', now)).toBe(false);
    expect(isRecentMeal(null, now)).toBe(false);
  });
});

describe('scrubbedMealPayload', () => {
  it('keeps nothing about the meal', () => {
    expect(
      scrubbedMealPayload({
        render_hint: 'meal_card',
        actors: [{ id: 'u1' }],
        entry_id: 'e1',
        title: 'Pancakes',
        calories: 900,
        image_id: 'img',
        photo_path: '/api/mobile/food-log/images/img?size=medium',
      })
    ).toEqual({ render_hint: 'meal_card', actors: [{ id: 'u1' }], entry_id: 'e1' });
  });
});
