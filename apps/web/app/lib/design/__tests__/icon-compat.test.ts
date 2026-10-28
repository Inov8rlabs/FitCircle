import { describe, expect, it } from 'vitest';

import { applyIconCompat, clientRendersIconKeys, iconCompatFor } from '../icon-compat';

const req = (features?: string) => ({ headers: { get: (n: string) => (n.toLowerCase() === 'x-client-features' ? features ?? null : null) } });

describe('clientRendersIconKeys', () => {
  it.each([
    [null, false],
    ['', false],
    ['garbage', false],
    ['icon_keys_v2', false],
    ['icon_keys', true],
    [' ICON_KEYS ', true],
    ['promo@1, icon_keys', true],
  ])('%j → %s', (v, want) => expect(clientRendersIconKeys(v as string | null)).toBe(want));
});

describe('applyIconCompat', () => {
  const payload = {
    milestone: { days: 7, badge: '🔥', badge_emoji: '🔥', icon: 'flame' },
    template: { id: 'x', icon: '💪', icon_key: 'strength' },
    db: { icon_name: '💪', icon_key: 'strength' },
    door: { day: 1, emoji: '🚶', icon: 'walk' },
    locked: { day: 2, state: 'locked' },
    promo: { emoji: '📸', icon: 'camera', badge: { text: 'New', tone: 'pro' } },
    unrelated: { emoji: '🔥', note: 'no icon key here' },
    workoutProvider: { icon: 'bike' },
    list: [{ emoji: '🎁', icon: 'gift' }],
  };

  it('returns the same object for shipped clients', () => {
    expect(applyIconCompat(payload, false)).toBe(payload);
    expect(iconCompatFor(req('promo@1'), payload)).toBe(payload);
    expect(iconCompatFor(req(), payload)).toBe(payload);
  });

  it('nulls legacy emoji next to an icon key for icon-key clients and promotes icon_key', () => {
    const out = iconCompatFor(req('icon_keys'), payload);
    expect(out.milestone).toEqual({ days: 7, badge: null, badge_emoji: null, icon: 'flame' });
    expect(out.template).toEqual({ id: 'x', icon: 'strength', icon_key: 'strength' });
    expect(out.db).toEqual({ icon_name: null, icon_key: 'strength' });
    expect(out.door).toEqual({ day: 1, emoji: null, icon: 'walk' });
    expect(out.locked).toEqual({ day: 2, state: 'locked' });
    expect(out.promo).toEqual({ emoji: null, icon: 'camera', badge: { text: 'New', tone: 'pro' } });
    expect(out.unrelated).toEqual({ emoji: '🔥', note: 'no icon key here' });
    expect(out.workoutProvider).toEqual({ icon: 'bike' });
    expect(out.list).toEqual([{ emoji: null, icon: 'gift' }]);
    expect(payload.milestone.badge).toBe('🔥'); // input untouched
  });
});
