import { describe, expect, it } from 'vitest';

import { toIosAuthUser } from '../ios-auth-user';

describe('toIosAuthUser', () => {
  it('fills the preference tree iOS requires when the profile stores {}', () => {
    const user = toIosAuthUser(
      { preferences: {}, goals: [], weight_kg: '72.50' },
      '11111111-1111-1111-1111-111111111111',
      'ani@privaterelay.appleid.com'
    );

    expect(user.preferences.notifications.push).toBe(true);
    expect(user.preferences.privacy.profile_visibility).toBe('public');
    expect(user.preferences.display.units).toBe('metric');
    expect(user.goals).toEqual([]);
    expect(user.weight_kg).toBe(72.5);
    expect(user.username).toBe('ani');
  });

  it('drops goal types the iOS enum cannot decode', () => {
    const user = toIosAuthUser(
      {
        preferences: {},
        goals: [
          { type: 'weight', target_weight_kg: 70 },
          { type: 'hydration' },
          'steps',
        ],
      },
      '11111111-1111-1111-1111-111111111111',
      'ani@bajirao.me'
    );

    expect(user.goals).toEqual([
      {
        type: 'weight',
        target_weight_kg: 70,
        starting_weight_kg: null,
        daily_steps_target: null,
      },
    ]);
  });
});
